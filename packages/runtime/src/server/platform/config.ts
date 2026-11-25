import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import env from 'env-var'
import * as z from 'zod/mini'

const PackageJson = z.object({ version: z.string() })
const BUILD = fileOr(new URL('../../../../../BUILD', import.meta.url), 'dev')
const RUNTIME_IMAGE = fileOr(new URL('../../../../../RUNTIME_IMAGE', import.meta.url), '')

// Every environment variable the server reads lives here (the agent host has its own, agentd/config.ts).
const DATA = env.get('OPENHUT_DATA').default('/data/app').asString() // where the database and files live
const SOCKET = env.get('OPENHUT_SOCKET').asString() // the desktop app's socket; set only by the desktop app
const TEST_MODEL = env.get('OPENHUT_MODEL').asString() === 'test' // 'test' answers with the built-in fake model
const HOST_NET = env.get('OPENHUT_AGENT_HOST_NET').default('false').asBool() // agents share the host's network (desktop)
const GATEWAY_PORT = env.get('OPENHUT_GATEWAY_PORT').default('8081').asPortNumber() // the agents' gateway
const FAKE_SANDBOX = env.get('OPENHUT_FAKE_SANDBOX').default('false').asBool() // tests: agentd's in-memory sandbox runs in this process unless AGENTD_SOCK is set
const AGENTD_SOCK = env.get('AGENTD_SOCK').asString() // the agent host's socket, when it runs as its own process

export const config = {
  dataDir: DATA,
  port: env.get('PORT').default('8787').asPortNumber(), // the server's HTTP port
  host: env.get('OPENHUT_HOST').default('127.0.0.1').asString(), // the address it listens on
  gatewayPort: GATEWAY_PORT,
  behindProxy: !!env.get('OPENHUT_PROXY').asString(), // install.sh proxy <port>: an upstream proxy serves HTTPS, Caddy doesn't run
  releaseUrl: env.get('OPENHUT_URL').default('https://openhut.dev').asString(), // where releases are downloaded from
  socket: SOCKET ?? join(DATA, 'openhut.sock'),
  installKind: installKindOf(SOCKET ? 'desktop' : 'server'),
  devKeySha256: env.get('OPENHUT_DEV_KEY_SHA256').asString(), // npm run dev and the tests only: sha256 of a key that acts as the owner
  appDir: fileURLToPath(new URL('../../../../app/dist', import.meta.url)), // the built web app, served on the same origin
  modelMode: TEST_MODEL ? 'test' as const : 'claude' as const,
  agentApi: env.get('OPENHUT_AGENT_API').asString(), // overrides the agents' API address (tests)
  agentGateway: HOST_NET ? `http://127.0.0.1:${GATEWAY_PORT}` : undefined,
  agentHostNet: HOST_NET,
  slackApi: 'https://slack.com/api',
  slackFiles: 'https://files.slack.com',
  telegramApi: 'https://api.telegram.org',
  discordApi: 'https://discord.com/api/v10',
  anthropicApi: TEST_MODEL ? `http://127.0.0.1:${GATEWAY_PORT}/test-anthropic` : 'https://api.anthropic.com',
  openrouterApi: process.env.OPENHUT_OPENROUTER_API || 'https://openrouter.ai/api', // a local fake in tests
  openaiApi: 'https://api.openai.com',
  codexApi: 'https://chatgpt.com/backend-api/codex',
  codexAuthApi: 'https://auth.openai.com',
  agentdSocket: AGENTD_SOCK ?? '/run/agentd/agentd.sock',
  agentdInProcess: FAKE_SANDBOX && !AGENTD_SOCK,
  secret: env.get('OPENHUT_SECRET').asString(), // the install's auth secret from the OS keychain (desktop); removed from the env below
  version: PackageJson.parse(JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))).version,
  build: BUILD,
  runtimeImage: env.get('OPENHUT_RUNTIME_IMAGE').default(RUNTIME_IMAGE).asString(), // the openhut-runtime image this build pairs with; every computer follows it
  hereTokenSha256: env.get('OPENHUT_HERE_TOKEN_SHA256').asString(), // sha256 of the token this install's own runtime links with (main-start.sh)
  installDir: env.get('OPENHUT_INSTALL_DIR').default('/data').asString(), // the update request, log and lock the updater shares
  claudeBin: fileURLToPath(new URL('../../../../../bin/claude', import.meta.url)),
  claudeHostBin: env.get('OPENHUT_CLAUDE').default('claude').asString(), // the Claude CLI the server runs itself for the seat sign-in
  path: env.get('PATH').default('/usr/bin:/bin').asString(), // the PATH Claude sign-in runs with
  started: Math.floor(Date.now() / 1000),
}
delete process.env.OPENHUT_SECRET

function installKindOf(kind: 'desktop' | 'server'): 'mac' | 'linux' | 'server' {
  if (kind === 'server') return 'server'
  return process.platform === 'darwin' ? 'mac' : 'linux'
}

function fileOr(url: URL, fallback: string): string {
  try { return readFileSync(url, 'utf8').trim() || fallback } catch { return fallback }
}
