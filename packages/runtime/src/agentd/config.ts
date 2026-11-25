import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import env from 'env-var'

// Every environment variable the agent host (agentd) reads lives here. It runs as its own process (and bundle), so it
// doesn't share the server's platform/config.ts, which reads files relative to the server's own bundle.
const ASSETS = env.get('AGENTD_ASSETS').asString() || dirname(fileURLToPath(new URL('../../../../package.json', import.meta.url))) // the release tree

export const config = {
  socket: env.get('AGENTD_SOCK').default('/run/agentd/agentd.sock').asString(), // where agentd listens
  image: env.get('AGENT_IMAGE').asString() || readFileSync(new URL('../../../../install/agent-image', import.meta.url), 'utf8').trim(), // the agents' container image
  assets: ASSETS,
  data: resolve(env.get('AGENTD_DATA').default('/data').asString()), // agentd's state: agent homes, update logs
  bin: join(ASSETS, 'bin'), // the agents' claude and agent-browser
  fakeSandbox: env.get('OPENHUT_FAKE_SANDBOX').default('false').asBool(), // tests only: agents in memory instead of Docker
  gatewayPort: env.get('OPENHUT_GATEWAY_PORT').default('8081').asPortNumber(), // the agents' gateway, for the fence check
}
