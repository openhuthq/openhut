import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { config } from '../../config.ts'
import { AGENT_UID, CLAUDE, conf, home, own } from '../../host.ts'
import type { Mount, SandboxSpec } from '../../sandbox/sandbox.ts'
import { CLAUDE_SETTINGS_FILE, FILES } from './conf.ts'
import { whatsapp } from './whatsapp.ts'

export const GUEST = '/opt/data'
const PLUGINS = `${config.assets}/vendor/hermes-plugins`
const MOUNTS = createHash('sha256').update(`${PLUGINS}\n${CLAUDE}`).digest('hex').slice(0, 16)
const SPEC = '4'
const RUNTIME_FILES = ['gateway.pid', 'gateway.lock', 'gateway_state.json']
const HOME_DIRS = ['', '/.claude', '/home', '/platforms', '/scripts', '/scripts/whatsapp-bridge', '/skills']
const LOCKED_TMPFS = [`${GUEST}/hooks`, `${GUEST}/pairing`, `${GUEST}/platforms/pairing`]
const AGENT_ENV = {
  HERMES_HOME: GUEST,
  TERMINAL_HOME_MODE: 'profile',
  PYTHONNOUSERSITE: '1',
  CLAUDE_CONFIG_DIR: `${GUEST}/.claude`,
  USER: 'hermes',
  HOME: `${GUEST}/home`,
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  HERMES_GATEWAY_LOCK_DIR: '/tmp/hermes-locks',
}

export function hermesSpec(id: string): Pick<SandboxSpec, 'entrypoint' | 'command' | 'env' | 'mounts' | 'tmpfs' | 'labels'> {
  return {
    entrypoint: '/opt/hermes/bin/hermes', command: ['gateway', 'run'], env: AGENT_ENV,
    mounts: [
      { host: home(id), guest: GUEST, readOnly: false },
      { host: `${home(id)}/platforms`, guest: `${GUEST}/platforms`, readOnly: false },
      { host: `${home(id)}/.claude`, guest: `${GUEST}/.claude`, readOnly: false },
      ...FILES.map((name) => confMount({ id, name, guest: name })),
      confMount({ id, name: CLAUDE_SETTINGS_FILE, guest: '.claude/settings.json' }),
      { host: PLUGINS, guest: `${GUEST}/plugins`, readOnly: true },
      { host: CLAUDE, guest: '/usr/local/bin/claude', readOnly: true },
      ...whatsapp.mounts(),
    ],
    tmpfs: LOCKED_TMPFS.map((guest) => ({ guest, sizeMib: 4 / 1024, readOnly: true })),
    labels: { 'openhut.spec': SPEC, 'openhut.mounts': MOUNTS },
  }
}

export function makeHome(id: string): void {
  for (const sub of HOME_DIRS) {
    const dir = `${home(id)}${sub}`
    mkdirSync(dir, { recursive: true })
    own({ path: dir, uid: AGENT_UID, gid: AGENT_UID, mode: 0o700 })
  }
}

export function beforeStart(id: string): void {
  for (const name of RUNTIME_FILES) rmSync(`${home(id)}/${name}`, { force: true })
}

function confMount({ id, name, guest }: { id: string; name: string; guest: string }): Mount {
  return { host: `${conf(id)}/${name}`, guest: `${GUEST}/${guest}`, readOnly: true }
}
