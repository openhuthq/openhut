import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'

const PackageJson = z.object({ version: z.string() })
const PORT = Number(process.env.PORT ?? 8787)

export const config = {
  dataDir: process.env.OPENHUT_DATA ?? '/data/app',
  port: PORT,
  host: process.env.OPENHUT_HOST ?? '127.0.0.1',
  gatewayPort: Number(process.env.OPENHUT_GATEWAY_PORT ?? 8081),
  releaseUrl: process.env.OPENHUT_URL ?? 'https://openhut.dev',
  telemetry: process.env.OPENHUT_MODEL !== 'test',
  cloudUrl: process.env.OPENHUT_CLOUD_URL ?? 'https://cloud.openhut.dev',
  telemetryUrl: `${process.env.OPENHUT_CLOUD_URL ?? 'https://cloud.openhut.dev'}/v1/events`,
  socket: process.env.OPENHUT_SOCKET,
  installKind: installKindOf(process.env.OPENHUT_SOCKET),
  clientKeySha256: process.env.OPENHUT_CLIENT_KEY_SHA256,
  modelMode: process.env.OPENHUT_MODEL === 'test' ? 'test' as const : 'claude' as const,
  agentApi: process.env.OPENHUT_AGENT_API,
  agentGateway: process.env.OPENHUT_AGENT_GATEWAY,
  slackApi: process.env.OPENHUT_SLACK_API ?? 'https://slack.com/api',
  telegramApi: process.env.OPENHUT_TELEGRAM_API ?? 'https://api.telegram.org',
  anthropicApi: process.env.OPENHUT_ANTHROPIC_API ?? (process.env.OPENHUT_MODEL === 'test' ? 'http://127.0.0.1:8081/test-anthropic' : 'https://api.anthropic.com'),
  openrouterApi: process.env.OPENHUT_OPENROUTER_API ?? 'https://openrouter.ai/api',
  openaiApi: process.env.OPENHUT_OPENAI_API ?? 'https://api.openai.com',
  xaiApi: process.env.OPENHUT_XAI_API ?? 'https://api.x.ai',
  codexApi: process.env.OPENHUT_CODEX_API ?? 'https://chatgpt.com/backend-api/codex',
  codexAuthApi: process.env.OPENHUT_CODEX_AUTH_API ?? 'https://auth.openai.com',
  agentdSocket: process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock',
  secret: process.env.OPENHUT_SECRET,
  secretHandoff: process.env.OPENHUT_SECRET_HANDOFF,
  version: PackageJson.parse(JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))).version,
  build: fileOr(new URL('../../../../../BUILD', import.meta.url), 'dev'),
  claudeBin: process.env.OPENHUT_CLAUDE ?? fileURLToPath(new URL('../../../../../bin/claude', import.meta.url)),
  claudeHostBin: process.env.OPENHUT_CLAUDE_HOST ?? fileURLToPath(new URL(`../../../../../bin/${process.platform === 'darwin' ? 'claude-darwin' : 'claude'}`, import.meta.url)),
  claudeVersion: process.env.OPENHUT_CLAUDE_VERSION,
  started: Math.floor(Date.now() / 1000),
}
delete process.env.OPENHUT_SECRET

function installKindOf(socket: string | undefined): 'mac' | 'linux' | 'server' {
  if (!socket) return 'server'
  return process.platform === 'darwin' ? 'mac' : 'linux'
}

function fileOr(url: URL, fallback: string): string {
  try { return readFileSync(url, 'utf8').trim() || fallback } catch { return fallback }
}
