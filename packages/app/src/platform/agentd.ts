import { connect } from 'node:net'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const TIMEOUT_MS = 180_000

export async function agentd<R extends AgentdRequest>(request: R): Promise<AgentdReplies[R['cmd']]> {
  const reply: ({ ok: true } & AgentdReplies[R['cmd']]) | { ok: false; error: string } = await send(request)
  if (!reply.ok) throw new HttpError(502, `The agent runner couldn't ${request.cmd} it: ${reply.error}.`)
  return reply
}

export async function containerStates(): Promise<Record<string, string> | undefined> {
  const reply = await agentd({ cmd: 'ps' }).catch(() => undefined)
  return reply?.states
}

function send<T>(request: AgentdRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.agentdSocket)
    let buffer = ''
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy()
      reject(new HttpError(504, `The agent runner didn't finish ${request.cmd} in time. Try again.`))
    })
    socket.on('data', (chunk) => { buffer += chunk })
    socket.on('end', () => {
      try { resolve(JSON.parse(buffer)) } catch { reject(new HttpError(502, `The agent runner sent a bad reply to ${request.cmd}.`)) }
    })
    socket.on('error', (err) => reject(new HttpError(503, `The agent runner isn't reachable (${err.message}). Check that agentd is running.`)))
    socket.end(`${JSON.stringify(request)}\n`)
  })
}

export type AgentFiles = Record<'config.yaml' | '.env' | 'SOUL.md', string>

export type AgentdRequest =
  | { cmd: 'health' }
  | { cmd: 'ps' }
  | { cmd: 'create'; id: string; net: number; files: AgentFiles }
  | { cmd: 'apply'; id: string; files: AgentFiles; restart: boolean; force?: boolean }
  | { cmd: 'start' | 'stop' | 'restart-now' | 'rm' | 'wa-pair' | 'wa-unlink'; id: string }

export type Pairing = { status: 'starting' | 'qr' | 'linked' | 'error'; qr?: string; phone?: string; error?: string }

export type AgentdReplies = {
  health: { runtime: string; firewall: boolean; image: string; watchdog: string }
  ps: { states: Record<string, string> }
  create: { container: string }
  apply: { applied: string; restarted: boolean }
  start: { started: string }
  stop: { stopped: string }
  'restart-now': { restarted: string }
  rm: { removed: string }
  'wa-pair': Pairing
  'wa-unlink': { unlinked: string }
}
