import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { duplexPair, Readable, type Duplex } from 'node:stream'
import type { Mux } from '@openhut/common/tunnel/mux.ts'
import { db } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { agentApiUrl } from '../platform/network.ts'
import { config } from '../platform/config.ts'
import { HERE } from '../team/home.ts'

export type Link = { mux: Mux; features: { whatsapp: boolean; browser: boolean }; gvisor: boolean | null; end: (revoked?: boolean) => void }

const SERVE = new URL(`../../agentd/serve.${import.meta.url.endsWith('.ts') ? 'ts' : 'mjs'}`, import.meta.url).href
const local = config.agentdInProcess ? await import(SERVE) as typeof import('../../agentd/serve.ts') : undefined
await local?.boot()
const links = new Map<string, Link>()
const waiting = new Set<() => void>()
const relayed = new Map<number, string>()
const OFFLINE = 'The computer that runs this agent is offline. Start it, or move the agent to another computer.'

export const forward = {
  link({ computer, link }: { computer: string; link: Link }): void {
    links.get(computer)?.end()
    links.set(computer, link)
    if (computer === HERE) for (const wake of waiting) wake()
  },

  unlink({ computer, link, revoked = false }: { computer: string; link?: Link; revoked?: boolean }): void {
    const held = links.get(computer)
    if (!held || (link && held !== link)) return
    links.delete(computer)
    held.end(revoked)
  },

  linked: (computer: string): Link | undefined => links.get(computer),

  gateway({ computer, stream }: { computer: string; stream: Duplex }): void {
    const gateway = connect(config.gatewayPort, '127.0.0.1')
    gateway.once('connect', () => {
      const port = gateway.localPort
      if (!port) return gateway.destroy()
      relayed.set(port, computer)
      gateway.once('close', () => relayed.delete(port))
      stream.pipe(gateway).pipe(stream)
    })
    gateway.on('error', () => stream.destroy())
    stream.on('error', () => gateway.destroy())
    stream.on('close', () => gateway.destroy())
  },

  relayedFrom: (port: number | undefined): string | undefined => port === undefined ? undefined : relayed.get(port),

  online: (computer: string): boolean => links.has(computer) || (computer === HERE && !links.size && !config.hereTokenSha256),

  ready({ on, ms }: { on: string; ms: number }): Promise<boolean> {
    if (links.has(on) || on !== HERE || !config.hereTokenSha256) return Promise.resolve(true)
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer)
        waiting.delete(wake)
        resolve(true)
      }
      const timer = setTimeout(() => {
        waiting.delete(wake)
        resolve(false)
      }, ms)
      waiting.add(wake)
    })
  },

  computers: (): string[] => links.size ? [...links.keys()] : [HERE],

  async computerOf(agentId: string | undefined): Promise<string> {
    if (!agentId) return HERE
    const row = await db.selectFrom('agent').select('runs_on').where('id', '=', agentId).executeTakeFirst()
    return row?.runs_on ?? HERE
  },

  open({ on, request }: { on: string; request: Record<string, unknown> }): Duplex {
    const link = links.get(on)
    if (link) return link.mux.open(request)
    if (on !== HERE) throw new HttpError(503, OFFLINE)
    if (request.to === 'agentd' && !config.hereTokenSha256) return localAgentd()
    throw new HttpError(503, OFFLINE)
  },

  async fetch({ agent, path, init }: { agent: { id: string; net: number }; path: string; init: RequestInit }): Promise<Response> {
    const on = await forward.computerOf(agent.id)
    if (!links.has(on) && on === HERE) return fetch(`${agentApiUrl(agent.net)}${path}`, init)
    const socket = forward.open({ on, request: { to: 'agent', net: agent.net } })
    return new Promise((resolve, reject) => {
      const req = httpRequest(`http://agent${path}`, { method: init.method, headers: init.headers as Record<string, string>, createConnection: () => socket, signal: init.signal ?? undefined }, (res) => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(res.headers)) if (typeof value === 'string') headers.set(name, value)
        resolve(new Response(res.statusCode === 204 ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode, headers }))
      })
      req.on('error', reject)
      req.end(typeof init.body === 'string' ? init.body : undefined)
    })
  },
}

function localAgentd(): Duplex {
  if (!local) return connect(config.agentdSocket)
  const [socket, agentdSide] = duplexPair()
  socket.once('close', () => agentdSide.destroy())
  agentdSide.once('close', () => socket.destroy())
  local.serve(agentdSide)
  return socket
}
