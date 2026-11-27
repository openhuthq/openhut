import { agentIds, home } from '../../host.ts'
import { refreshPrompts, RESTART_KEY, CLAUDE_SETTINGS_FILE, validateFiles, writeConf } from './conf.ts'
import { newMessages, usage } from './db.ts'
import { agentHome } from './home.ts'
import { beforeStart, GUEST, hermesSpec, makeHome } from './spec.ts'
import { whatsapp } from './whatsapp.ts'

export const hermesBox = {
  guest: GUEST,
  validateFiles,
  writeConf,
  refreshPrompts,
  makeHome,
  spec: hermesSpec,
  beforeStart,
  restartFiles: [RESTART_KEY, CLAUDE_SETTINGS_FILE],
  messages: (since: number) => newMessages({ agents: stateDbs(), since }),
  usage: (since: number) => usage({ agents: stateDbs(), since }),
  home: agentHome,
  whatsapp,
}

function stateDbs() {
  return agentIds().map((id) => ({ id, file: `${home(id)}/state.db` }))
}

export type { AgentFiles } from './conf.ts'
export type { Kind } from './home.ts'
