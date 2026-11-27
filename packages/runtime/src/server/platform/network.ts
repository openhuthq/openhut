import { lookup as lookupAll, type LookupAddress, type LookupOptions } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { BlockList, createServer, isIP } from 'node:net'
import { Agent, buildConnector } from 'undici'
import { AGENT_API_PORT, AGENT_API_PORT_BASE, BROWSER_STREAM_PORT_BASE, WHATSAPP_PORT_BASE } from '../../agentd/network/ports.ts'
import { config } from './config.ts'

export const AGENTS_RANGE = '10.200.0.0'
export const agentSubnet = (net: number): string => `10.200.${net}`
export const agentApiUrl = (net: number): string => config.agentApi ?? (config.agentGateway ? `http://127.0.0.1:${AGENT_API_PORT_BASE + net}` : `http://${agentSubnet(net)}.2:${AGENT_API_PORT}`)

export async function portsFree(net: number): Promise<boolean> {
  if (!config.agentHostNet) return true
  return (await Promise.all([AGENT_API_PORT_BASE, WHATSAPP_PORT_BASE, BROWSER_STREAM_PORT_BASE].map((base) => portFree(base + net)))).every(Boolean)
}

export function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer().once('error', () => done(false))
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)))
  })
}

const BLOCKED = blockList()
const connector = buildConnector({ lookup: guardedLookup, timeout: 10_000 })
const guard = new Agent({ connect: guardedConnect, headersTimeout: 30_000, bodyTimeout: 60_000 })

export const refused = (ip: string): boolean => BLOCKED.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4')

export async function checkedAddress(host: string): Promise<string> {
  const ip = isIP(host) ? host : (await lookup(host)).address
  if (refused(ip)) throw refusal(ip)
  return ip
}

export function guardedFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, dispatcher: guard } as RequestInit)
}

function guardedConnect(options: buildConnector.Options, callback: buildConnector.Callback): void {
  const host = options.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && refused(host)) return callback(refusal(host), null)
  connector(options, callback)
}

export function guardedLookup(hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void {
  lookupAll(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, [])
    const bad = addresses.find((each) => refused(each.address))
    if (bad) return callback(refusal(bad.address), [])
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

function refusal(ip: string): Error {
  return new Error(`Refused address ${ip}: OpenHut never connects to this server, its agents or link-local addresses. Use the service's own address.`)
}

function blockList(): BlockList {
  const list = new BlockList()
  for (const [net, bits] of [['127.0.0.0', 8], ['0.0.0.0', 8], ['169.254.0.0', 16], [AGENTS_RANGE, 16]] as const) list.addSubnet(net, bits, 'ipv4')
  for (const [net, bits] of [['::1', 128], ['::', 128], ['fe80::', 10]] as const) list.addSubnet(net, bits, 'ipv6')
  return list
}
