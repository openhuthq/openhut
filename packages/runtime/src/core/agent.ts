import { hermes } from '../adapters/hermes/index.ts'
import type { GatewayAgent } from '../server/agents/agent-service.ts'
import type { Slots } from '../server/models/model-slots.ts'
import type { Change, Stream } from '../server/platform/agentd.ts'
import type { RenderedChannel } from '../plugins/channels/index.ts'

export type AgentCtx = {
  agent: { id: string; name: string; instructions: string; slots: Slots; net: number; code_execution: boolean; web_browser: boolean; notify?: string | null }
  gateway: string
  token: string
  channelKey: string
  channels: RenderedChannel[]
  connections: { name: string; kind: string }[]
  secrets: { name: string; hosts: string[] }[]
}

export type AgentPart = {
  instructions?: string
  secrets?: Record<string, string>
  model?: { auth?: object }
  limits?: { subagents?: { depth: number; concurrent: number } }
  native?: { hermes?: { config?: Record<string, unknown>; env?: Record<string, string> } }
  restart?: unknown
}

export type Source = { platform: string; chatId?: string; threadId?: string; userId?: string; userName?: string }
export type ContentKind = 'instructions' | 'memory' | 'skill' | 'file' | 'upload' | 'session'
export type ContentRef = { kind: ContentKind; name: string }
export type ChatEvent = { type: 'text'; delta: string } | { type: 'tool'; progress: unknown } | { type: 'error'; message: string; lost: boolean } | { type: 'dropped' } | { type: 'done'; finish: string | null | undefined; ended: boolean }
export type AgentStatus = 'running' | 'exited' | 'created'

export type AgentEvents = {
  'message.arriving': { in: { text: string; source?: Source }; out: { allow?: string; skip?: string } }
  'reply.drafted': { in: { text: string; source?: Source }; out: { text: string } }
  'subagent.started': { in: { child: string; goal: string }; out: void }
  'subagent.stopped': { in: { child: string; status: string }; out: void }
  'content.written': { in: { ref: ContentRef; by: 'person' | 'agent' }; out: void }
}
export type Handler<E extends keyof AgentEvents> = (x: { agent: GatewayAgent; event: AgentEvents[E]['in'] }) => Promise<AgentEvents[E]['out'] | undefined>

export type AutonomousAgent = {
  setup(x: { ctx: Omit<AgentCtx, 'gateway'>; on?: string; browser: boolean; running: boolean; restart?: boolean }): Promise<Change>
  stop(id: string, opts?: { on?: string }): Promise<void>
  remove(id: string, opts?: { on?: string; keep?: boolean }): Promise<void>
  status(opts?: { on?: string }): Promise<Record<string, string> | undefined>
  chat(x: { agent: { id: string; name: string; net: number; channel_key: string }; session: string; message: object; system: string; signal: AbortSignal }): AsyncGenerator<ChatEvent>
  content: {
    list(id: string, kind: 'skill'): Promise<{ items: { name: string; head: string }[]; bundled: string }>
    read(id: string, ref: ContentRef): Promise<Buffer | null>
    write(x: { id: string; ref: ContentRef; body: Buffer | string; by: 'person' | 'agent'; create?: boolean; replace?: boolean }): Promise<ContentRef>
    remove(id: string, refs: ContentRef[]): Promise<ContentRef[]>
    stat(id: string, refs: ContentRef[]): Promise<{ ref: ContentRef; size: number }[]>
  }
  activity(since: number): Promise<{ cost: Record<string, number> }>
  readonly on: { [E in keyof AgentEvents]: Handler<E>[] }
  attach(x: { id: string; what: 'browser' | 'whatsapp-pairing'; fps?: number; onLine: (line: string) => void; onEnd: () => void }): Stream
}

export const agent: AutonomousAgent = hermes
