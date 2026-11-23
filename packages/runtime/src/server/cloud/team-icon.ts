import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { BlockList } from 'node:net'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { siteHost } from '@openhut/common/cloud/cloud.ts'
import { config } from '../platform/config.ts'

export type TeamIcon = { type: string; bytes: Buffer }
type Link = { href: string; png: boolean; size: number }

const DIR = join(config.dataDir, 'team-icons')
const DAY_MS = 24 * 60 * 60_000
const TIMEOUT_MS = 8000
const MAX_ICON = 256 * 1024
const MAX_PAGE = 512 * 1024
const MAX_HOPS = 5
const TYPES = ['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/gif', 'image/webp']
const Kept = z.object({ at: z.number(), type: z.nullable(z.string()), data: z.string() })
const PRIVATE = new BlockList()
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) PRIVATE.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) PRIVATE.addSubnet(net, prefix, 'ipv6')

export const teamIcon = {
  async get(site: string): Promise<TeamIcon | null> {
    const file = join(DIR, `${createHash('sha256').update(site).digest('hex').slice(0, 32)}.json`)
    const kept = await readFile(file, 'utf8').then((text) => Kept.parse(JSON.parse(text))).catch(() => null)
    if (kept && Date.now() - kept.at < DAY_MS) return iconOf(kept)
    const fresh = await fetchIcon({ page: `https://${site}/` }).catch(() => null)
    const next = fresh ? { at: Date.now(), type: fresh.type, data: fresh.bytes.toString('base64') } : { at: Date.now(), type: kept?.type ?? null, data: kept?.data ?? '' }
    await mkdir(DIR, { recursive: true, mode: 0o700 })
    await writeFile(file, JSON.stringify(next), { mode: 0o600 })
    return iconOf(next)
  },
}

export async function fetchIcon({ page, allow = isPublic }: { page: string; allow?: (host: string) => Promise<boolean> }): Promise<TeamIcon | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const html = await get({ url: page, allow, signal })
  const base = html?.url ?? page
  const text = html?.response.ok && /html/i.test(html.response.headers.get('content-type') ?? '') ? (await read({ response: html.response, max: MAX_PAGE })).bytes.toString('utf8') : ''
  if (html && !text) await html.response.body?.cancel()
  for (const href of [...linksOf(text).slice(0, 3).map((link) => link.href), '/favicon.ico']) {
    const url = URL.parse(href, base)?.href
    const found = url && await get({ url, allow, signal })
    if (!found) continue
    const type = (found.response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    const body = found.response.ok && TYPES.includes(type) ? await read({ response: found.response, max: MAX_ICON }) : null
    if (body && !body.over && body.bytes.length) return { type: type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : type, bytes: body.bytes }
    if (!body) await found.response.body?.cancel()
  }
  return null
}

export function linksOf(html: string): Link[] {
  return [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map(([, key, a, b, c]) => [key?.toLowerCase() ?? '', a ?? b ?? c ?? '']))
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/)
    const href = (attrs.href ?? '').replaceAll('&amp;', '&').trim()
    if (!href || !rel.some((token) => token === 'icon' || token === 'apple-touch-icon')) return []
    const type = (attrs.type ?? '').toLowerCase()
    const svg = type === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(href)
    const sizes = (attrs.sizes ?? '').toLowerCase().split(/\s+/).map((each) => Number(each.split('x')[0]) || 0)
    const size = svg || attrs.sizes?.toLowerCase() === 'any' ? Infinity : Math.max(rel.includes('apple-touch-icon') ? 180 : 16, ...sizes)
    return [{ href, png: svg || type === 'image/png' || /\.png(?:[?#]|$)/i.test(href) || rel.includes('apple-touch-icon'), size }]
  }).sort((a, b) => Number(b.png) - Number(a.png) || b.size - a.size)
}

async function get({ url, allow, signal }: { url: string; allow: (host: string) => Promise<boolean>; signal: AbortSignal }): Promise<{ url: string; response: Response } | null> {
  for (let hop = 0, next = url; hop <= MAX_HOPS; hop++) {
    const target = URL.parse(next)
    if (!target || !['http:', 'https:'].includes(target.protocol) || !await allow(target.hostname.replace(/^\[|\]$/g, ''))) return null
    const response = await fetch(target, { redirect: 'manual', signal, headers: { accept: 'text/html,image/*;q=0.9,*/*;q=0.5', 'user-agent': 'OpenHut' } }).catch(() => null)
    if (!response) return null
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
    if (!location) return { url: target.href, response }
    await response.body?.cancel()
    next = URL.parse(location, target)?.href ?? ''
  }
  return null
}

async function read({ response, max }: { response: Response; max: number }): Promise<{ bytes: Buffer; over: boolean }> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body ?? []) {
    chunks.push(chunk)
    size += chunk.length
    if (size > max) break
  }
  return { bytes: Buffer.concat(chunks).subarray(0, max), over: size > max }
}

async function isPublic(host: string): Promise<boolean> {
  const found = await lookup(host, { all: true }).catch(() => [])
  return found.length > 0 && found.every(({ address, family }) => !PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4'))
}

function iconOf(kept: z.infer<typeof Kept>): TeamIcon | null {
  return kept.type && kept.data ? { type: kept.type, bytes: Buffer.from(kept.data, 'base64') } : null
}

const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'hey.com', 'fastmail.com', 'qq.com', '163.com'])

export function guessSite(members: { email: string; role: string }[]): string | null {
  for (const member of [...members.filter((each) => each.role === 'owner'), ...members]) {
    const domain = member.email.split('@')[1]?.toLowerCase()
    if (domain && !PERSONAL.has(domain)) return siteHost(domain)
  }
  return null
}
