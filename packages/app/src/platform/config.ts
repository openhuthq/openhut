import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'

const PackageJson = z.object({ version: z.string() })

export const config = {
  dataDir: process.env.OPENHUT_DATA ?? '/data/app',
  port: Number(process.env.PORT ?? 8787),
  gatewayPort: 8081,
  releaseUrl: process.env.OPENHUT_URL ?? 'https://openhut.dev',
  setupCode: process.env.SETUP_CODE ?? '',
  modelMode: process.env.OPENHUT_MODEL === 'test' ? 'test' as const : 'claude' as const,
  agentApi: process.env.OPENHUT_AGENT_API,
  agentdSocket: process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock',
  version: PackageJson.parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))).version,
  build: fileOr(new URL('../../../../BUILD', import.meta.url), 'dev'),
  claudeBin: process.env.OPENHUT_CLAUDE ?? fileURLToPath(new URL('../../../../bin/claude', import.meta.url)),
  started: Math.floor(Date.now() / 1000),
  webDist: new URL('../../../web/dist/', import.meta.url),
}

function fileOr(url: URL, fallback: string): string {
  try { return readFileSync(url, 'utf8').trim() || fallback } catch { return fallback }
}
