import { execFile } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { EXEC, isRecord } from './util.ts'

const run = promisify(execFile)
const INSTALL_MS = 170_000
const UP_MS = 120_000
export const TAILSCALE_KEY = /^tskey-auth-[\w-]{10,200}$/

export type Tailnet = { state: string; tailnet: string; name: string; address: string }

export async function tailscaleUp({ authKey, keyFile }: { authKey: string; keyFile: string }): Promise<Tailnet & { joined: boolean }> {
  if (!(await hasTailscale())) await run('sh', ['-c', 'curl -fsSL https://tailscale.com/install.sh | sh'], { ...EXEC, timeout: INSTALL_MS })
  const before = await tailscaleStatus()
  if (before.state === 'Running') return { ...before, joined: false }
  writeFileSync(keyFile, authKey, { mode: 0o600 })
  try {
    await run('tailscale', ['up', `--auth-key=file:${keyFile}`, '--hostname=openhut'], { ...EXEC, timeout: UP_MS })
  } finally {
    rmSync(keyFile, { force: true })
  }
  return { ...(await tailscaleStatus()), joined: true }
}

export async function tailscaleDown(): Promise<Tailnet> {
  await run('tailscale', ['logout'], EXEC)
  return tailscaleStatus()
}

export async function tailscaleStatus(): Promise<Tailnet> {
  if (!(await hasTailscale())) return { state: 'NotInstalled', tailnet: '', name: '', address: '' }
  const { stdout } = await run('tailscale', ['status', '--json'], EXEC).catch((e: unknown) => ({ stdout: isRecord(e) && typeof e.stdout === 'string' ? e.stdout : '{}' }))
  const status: unknown = JSON.parse(stdout || '{}')
  const field = (value: unknown, key: string) => isRecord(value) ? value[key] : undefined
  const ips = field(field(status, 'Self'), 'TailscaleIPs')
  return {
    state: String(field(status, 'BackendState') ?? 'Stopped'),
    tailnet: String(field(field(status, 'CurrentTailnet'), 'Name') ?? ''),
    name: String(field(field(status, 'Self'), 'DNSName') ?? '').replace(/\.$/, ''),
    address: Array.isArray(ips) ? String(ips[0] ?? '') : '',
  }
}

function hasTailscale(): Promise<boolean> {
  return run('sh', ['-c', 'command -v tailscale'], EXEC).then(() => true, () => false)
}
