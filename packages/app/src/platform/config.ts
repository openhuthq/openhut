import env from 'env-var'
import { readFileSync } from 'node:fs'

export const config = {
  dataDir: env.get('JAKEBOX_DATA').default('/data/app').asString(),
  port: 8787,
  gatewayPort: 8081,
  setupCode: env.get('SETUP_CODE').default('').asString(),
  modelMode: env.get('JAKEBOX_MODEL').asString() === 'test' ? 'test' as const : 'claude' as const,
  agentdSocket: env.get('AGENTD_SOCK').default('/run/agentd/agentd.sock').asString(),
  slackApi: env.get('SLACK_API_URL').default('https://slack.com/api').asUrlString().replace(/\/+$/, ''),
  production: env.get('NODE_ENV').asString() === 'production',
  version: String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version),
  build: fileOr(new URL('../../../../BUILD', import.meta.url), 'dev'),
  started: Math.floor(Date.now() / 1000),
  webDist: new URL('../../../web/dist/', import.meta.url),
}

function fileOr(url: URL, fallback: string): string {
  try { return readFileSync(url, 'utf8').trim() || fallback } catch { return fallback }
}
