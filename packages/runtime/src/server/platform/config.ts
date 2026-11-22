import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'

const PackageJson = z.object({ version: z.string() })
const NativeRuntime = z.object({ claude: z.object({ version: z.string() }) })
const PORT = Number(process.env.PORT ?? 8787)
const DATA = process.env.OPENHUT_DATA ?? '/data/app'
const BUILD = fileOr(new URL('../../../../../BUILD', import.meta.url), 'dev')
const JOIN = process.env.OPENHUT_JOIN || undefined
const TEST_MODEL = process.env.OPENHUT_MODEL === 'test'
const HOST_NET = process.env.OPENHUT_AGENT_HOST_NET === '1'
const GATEWAY_PORT = Number(process.env.OPENHUT_GATEWAY_PORT ?? 8081)

export const config = {
  dataDir: DATA,
  port: PORT,
  host: process.env.OPENHUT_HOST ?? '127.0.0.1',
  gatewayPort: GATEWAY_PORT,
  releaseUrl: process.env.OPENHUT_URL ?? 'https://openhut.dev',
  telemetry: !TEST_MODEL && BUILD !== 'dev',
  cloudUrl: process.env.OPENHUT_CLOUD_URL ?? 'https://cloud.openhut.dev',
  telemetryUrl: `${process.env.OPENHUT_CLOUD_URL ?? 'https://cloud.openhut.dev'}/v1/events`,
  socket: process.env.OPENHUT_SOCKET ?? join(DATA, 'openhut.sock'),
  installKind: installKindOf(process.env.OPENHUT_SOCKET ? 'desktop' : 'server'),
  clientKeySha256: process.env.OPENHUT_CLIENT_KEY_SHA256,
  modelMode: TEST_MODEL ? 'test' as const : 'claude' as const,
  agentApi: process.env.OPENHUT_AGENT_API,
  agentGateway: HOST_NET ? `http://127.0.0.1:${GATEWAY_PORT}` : undefined,
  agentHostNet: HOST_NET,
  slackApi: 'https://slack.com/api',
  telegramApi: 'https://api.telegram.org',
  anthropicApi: TEST_MODEL ? `http://127.0.0.1:${GATEWAY_PORT}/test-anthropic` : 'https://api.anthropic.com',
  openrouterApi: 'https://openrouter.ai/api',
  openaiApi: 'https://api.openai.com',
  xaiApi: 'https://api.x.ai',
  codexApi: 'https://chatgpt.com/backend-api/codex',
  codexAuthApi: 'https://auth.openai.com',
  agentdSocket: process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock',
  secret: process.env.OPENHUT_SECRET,
  secretHandoff: process.env.OPENHUT_SECRET_HANDOFF,
  version: PackageJson.parse(JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))).version,
  build: BUILD,
  join: JOIN,
  tailnetPort: Number(process.env.OPENHUT_TAILNET_PORT ?? 0),
  relayUrl: process.env.OPENHUT_RELAY_URL ?? relayOf(JOIN) ?? (BUILD === 'dev' ? undefined : 'wss://cloud.openhut.dev'),
  claudeBin: fileURLToPath(new URL('../../../../../bin/claude', import.meta.url)),
  claudeHostBin: process.env.OPENHUT_BIN ? join(process.env.OPENHUT_BIN, process.platform === 'win32' ? 'claude.exe' : 'claude') : fileURLToPath(new URL(`../../../../../bin/${process.platform === 'darwin' ? 'claude-darwin' : 'claude'}`, import.meta.url)),
  claudeVersion: claudeVersionOf(new URL('../../../../../install/native-runtime.json', import.meta.url)),
  hermesRuntime: process.env.AGENTD_HERMES,
  started: Math.floor(Date.now() / 1000),
}
delete process.env.OPENHUT_SECRET

function claudeVersionOf(url: URL): string | undefined {
  try { return z.parse(NativeRuntime, JSON.parse(readFileSync(url, 'utf8'))).claude.version } catch { return undefined }
}

function installKindOf(kind: 'desktop' | 'server'): 'mac' | 'linux' | 'server' {
  if (kind === 'server') return 'server'
  return process.platform === 'darwin' ? 'mac' : 'linux'
}

function relayOf(code: string | undefined): string | undefined {
  if (!code) return undefined
  try { return new URL(code).searchParams.get('r') ?? undefined } catch { return undefined }
}

function fileOr(url: URL, fallback: string): string {
  try { return readFileSync(url, 'utf8').trim() || fallback } catch { return fallback }
}
