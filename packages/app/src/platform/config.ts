import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'

const PackageJson = z.object({ version: z.string() })

export const config = {
  dataDir: process.env.FASTMONKEY_DATA ?? '/data/app',
  port: 8787,
  gatewayPort: 8081,
  releaseUrl: process.env.FASTMONKEY_URL ?? 'https://fastmonkey.dev',
  setupCode: process.env.SETUP_CODE ?? '',
  modelMode: process.env.FASTMONKEY_MODEL === 'test' ? 'test' as const : 'claude' as const,
  agentdSocket: process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock',
  version: PackageJson.parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))).version,
  build: fileOr(new URL('../../../../BUILD', import.meta.url), 'dev'),
  started: Math.floor(Date.now() / 1000),
  webDist: new URL('../../../web/dist/', import.meta.url),
}

function fileOr(url: URL, fallback: string): string {
  try { return readFileSync(url, 'utf8').trim() || fallback } catch { return fallback }
}
