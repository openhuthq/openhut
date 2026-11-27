import { fileURLToPath } from 'node:url'

export const FIREWALL = fileURLToPath(new URL('../../../../../install/agents-firewall.sh', import.meta.url))
export const AGENT_API_PORT = 8642
export const AGENT_API_PORT_BASE = 18600
export const WHATSAPP_PORT_BASE = 19600
export const BROWSER_STREAM_PORT_BASE = 20600
export const RESOLV = '/etc/agentd/resolv.conf'
export const ID = /^ag_[a-z0-9]{8}$/
