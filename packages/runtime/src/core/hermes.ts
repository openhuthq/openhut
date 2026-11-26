import type { AgentFiles } from '../server/platform/agentd.ts'
import { config } from '../server/platform/config.ts'
import { HttpError } from '../server/platform/http-error.ts'
import { agentSubnet } from '../server/platform/network.ts'
import type { HermesCtx } from './plugin.ts'
import { plugins } from './plugins.ts'

const EMPTY_AUTH = { version: 1, providers: {} }
const UI_PLUGIN = 'openhut-ui'

export function hermesFiles(input: Omit<HermesCtx, 'gateway'>): AgentFiles {
  const ctx = { ...input, gateway: config.agentGateway ?? `http://${agentSubnet(input.agent.net)}.1:${config.gatewayPort}` }
  const parts = plugins.map((plugin) => plugin.hermes?.(ctx) ?? {})
  const merged = merge([...parts.map((part) => part.config ?? {}), {
    mcp_servers: { openhut: { url: `${ctx.gateway}/api/v1/mcp`, headers: { Authorization: `Agent ${ctx.token}` } } },
    plugins: { enabled: [UI_PLUGIN], entries: { [UI_PLUGIN]: { allow_gateway_injection: true } } },
  }])
  const env = Object.assign({ OPENHUT_GATEWAY: ctx.gateway, OPENHUT_AGENT_TOKEN: ctx.token }, ...parts.map((part) => part.env))
  return {
    'config.yaml': `${JSON.stringify(merged, null, 2)}\n`,
    '.env': `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    'SOUL.md': `${parts.flatMap((part) => part.prompt?.trim() || []).join('\n\n')}\n`,
    'auth.json': `${JSON.stringify(parts.find((part) => part.auth)?.auth ?? EMPTY_AUTH)}\n`,
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
