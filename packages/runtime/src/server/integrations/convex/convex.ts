import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { HttpError } from '../../platform/http-error.ts'
import { mcp } from '../mcp/mcp.ts'

// Convex's own MCP server (`convex mcp start`, https://docs.convex.dev/ai/convex-mcp-server), run over stdio on this computer with the deploy key in its env.
const DEPLOY_KEY = /^(dev|prod|preview|project):[\w-]+\|\S+$/
const CLI = join(createRequire(import.meta.url).resolve('convex/package.json'), '..', 'bin', 'main.js')
const Config = z.object({ deployKey: z.string() })

const connector = mcp.connector({
  redirectUrl: () => '',
  stdio: (config) => {
    const { deployKey } = z.parse(Config, config)
    return {
      command: process.execPath,
      // The env tools would hand agents the deployment's secrets, so they stay off. A prod key is the person's explicit choice, so it gets full access like any other key.
      args: [CLI, 'mcp', 'start', '--disable-tools', 'envList,envGet,envSet,envRemove,insights', ...(deployKey.startsWith('prod:') ? ['--dangerously-enable-production-deployments'] : [])],
      env: { CONVEX_DEPLOY_KEY: deployKey }, // on top of the SDK's safe default env (HOME, PATH, …), never the server's own secrets
      cwd: tmpdir(),
    }
  },
})

export const convex = {
  connector,

  async probe(deployKey: string): Promise<string> {
    if (!DEPLOY_KEY.test(deployKey)) throw new HttpError(400, 'Paste a deploy key from the Convex dashboard: Settings › Deploy keys. It looks like prod:happy-otter-123|eyJ…', { param: 'deployKey' })
    const status = await connector.call({ config: { deployKey }, refresh: async () => ({}), tool: 'status', args: {} })
    if (status.isError) throw new HttpError(400, 'Convex refused that deploy key. Copy the whole key again and check it hasn’t been revoked.', { param: 'deployKey' })
    return deployKey.split('|')[0] ?? 'the deployment'
  },
}
