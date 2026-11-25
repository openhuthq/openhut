import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import env from 'env-var'

// Every environment variable the agent host (agentd) reads lives here. It runs as its own process (and bundle), so it
// doesn't share the server's platform/config.ts, which reads files relative to the server's own bundle.
const DATA = resolve(env.get('AGENTD_DATA').default('/data').asString()) // agentd's state: agent homes, native sandboxes, update logs
const ASSETS = env.get('AGENTD_ASSETS').asString() || dirname(fileURLToPath(new URL('../../../../package.json', import.meta.url))) // the release tree
const BIN = env.get('OPENHUT_BIN').asString() || join(ASSETS, 'bin') // native binaries (claude, agent-browser)

export const config = {
  socket: env.get('AGENTD_SOCK').default('/run/agentd/agentd.sock').asString(), // where agentd listens
  image: env.get('AGENT_IMAGE').asString() || readFileSync(new URL('../../../../install/agent-image', import.meta.url), 'utf8').trim(), // the agents' container image
  assets: ASSETS,
  data: DATA,
  bin: BIN,
  inImage: env.get('OPENHUT_RUNTIME').asString() === 'image', // 'image': agentd runs inside the server image, updates are a request file
  claude: env.get('OPENHUT_CLAUDE').asString(), // the server's own Claude build (musl on the image), for non-image installs
  sandbox: env.get('OPENHUT_SANDBOX').default('gvisor').asEnum(['gvisor', 'native', 'memory']), // how agents are isolated
  hermesRuntime: env.get('AGENTD_HERMES').asString() || join(DATA, 'runtime'), // the bundled Python and Node runtime
  releaseUrl: env.get('OPENHUT_URL').default('https://openhut.dev').asString(), // where updates are downloaded from
  gatewayPort: env.get('OPENHUT_GATEWAY_PORT').default('8081').asPortNumber(), // the agents' gateway, for the fence check
  systemRoot: env.get('SystemRoot').default('C:\\Windows').asString(), // Windows only, for the native sandbox's PATH
  windowsAppDirs: [env.get('ProgramFiles').asString(), env.get('ProgramFiles(x86)').asString(), env.get('LOCALAPPDATA').asString()], // Windows only, to find Chrome
}
