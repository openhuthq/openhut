import { createHash } from 'node:crypto'
import type { AgentCtx, AgentPart } from '../../core/agent.ts'
import { plugins } from '../../core/plugins.ts'
import type { AgentFiles } from '../../server/platform/agentd.ts'
import { config } from '../../server/platform/config.ts'
import { HttpError } from '../../server/platform/http-error.ts'
import { agentSubnet } from '../../server/platform/network.ts'
import { manifest } from './events.ts'

const EMPTY_AUTH = { version: 1, providers: {} }
const PYTHON_PLUGIN = 'openhut'

type HermesPart = { prompt?: string; config?: Record<string, unknown>; env?: Record<string, string>; auth?: object; restart?: unknown }

export function render(input: Omit<AgentCtx, 'gateway'>): AgentFiles {
  const ctx = { ...input, gateway: config.agentGateway ?? `http://${agentSubnet(input.agent.net)}.1:${config.gatewayPort}` }
  const parts = plugins().map((plugin) => hermesPart(plugin.agent?.(ctx) ?? {}))
  const merged = merge([...parts.map((part) => part.config ?? {}), {
    mcp_servers: { openhut: { url: `${ctx.gateway}/api/v1/mcp`, headers: { Authorization: `Agent ${ctx.token}` } } },
    plugins: { enabled: [PYTHON_PLUGIN], entries: { [PYTHON_PLUGIN]: { allow_gateway_injection: true, settings: manifest() } } },
  }])
  const env = Object.assign({ OPENHUT_GATEWAY: ctx.gateway, OPENHUT_AGENT_TOKEN: ctx.token }, ...parts.map((part) => part.env))
  const restart = createHash('sha256').update(JSON.stringify([config.version, ctx.gateway, ctx.token, ...parts.map((part) => 'restart' in part ? part.restart : [part.config, part.env, part.auth])])).digest('hex')
  return {
    'config.yaml': `${JSON.stringify(merged, null, 2)}\n`,
    '.env': `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    'SOUL.md': `${parts.flatMap((part) => part.prompt?.trim() || []).join('\n\n')}\n`,
    'auth.json': `${JSON.stringify(parts.find((part) => part.auth)?.auth ?? EMPTY_AUTH)}\n`,
    'restart.key': `${restart}\n`,
  }
}

function hermesPart(part: AgentPart): HermesPart {
  const native = part.native?.hermes ?? {}
  const subagents = part.limits?.subagents
  const delegation = subagents && { delegation: { max_spawn_depth: subagents.depth, max_concurrent_children: subagents.concurrent } }
  return {
    prompt: part.instructions,
    config: delegation || native.config ? merge([delegation ?? {}, native.config ?? {}]) : undefined,
    env: part.secrets || native.env ? { ...native.env, ...part.secrets } : undefined,
    auth: part.model?.auth,
    ...'restart' in part && { restart: part.restart },
  }
}

export function merge(objects: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) {
      const had = out[key]
      if (Array.isArray(had) && Array.isArray(value)) out[key] = [...had, ...value]
      else if (isObject(had) && isObject(value)) out[key] = merge([had, value])
      else if (had !== undefined && had !== value) throw new HttpError(500, `Two plugins set ${key} in the agent's Hermes config differently.`)
      else out[key] = value
    }
  }
  return out
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
