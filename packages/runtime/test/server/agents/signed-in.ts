import { createServer } from 'node:net'
import type { MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { keysService } from '../../../src/server/cloud/keys-service.ts'
import type { Account, Room } from '../../../src/server/cloud/key-store.ts'
import { roomKeys } from '../../../src/server/cloud/room-keys.ts'
import { useFakeRecords } from '../cloud/records-fake.ts'

export const HOME = 'ws_home0001'

export function signIn({ email = 'mo@example.com', me = 'dev_mac', others = ['dev_srv'] }: { email?: string; me?: string; others?: string[] } = {}) {
  const device = { me }
  const fake = useFakeRecords({ by: me })
  const list: MemberListBody = { workspace: HOME, version: 1, previous: null, members: [{ email, role: 'owner', devices: [me, ...others] }, { email: 'teammate@example.com', role: 'member', devices: ['dev_mate'] }], invites: [], removed: [], runtimes: others }
  const account = { email, workspace: { id: HOME, key: 'a2V5', version: 1 } } as unknown as Account
  const room = { workspace: { id: HOME, key: 'a2V5', version: 1 } } as unknown as Room
  Object.assign(keysService, { account: () => account, mustBeOn: () => account, signedIn: () => account, session: () => ({}), deviceKey: async () => device.me })
  Object.assign(roomKeys, { rooms: () => [room], room: (ws?: string) => ws === HOME ? room : undefined, members: (ws?: string) => ws === HOME ? list : undefined, roleIn: (ws?: string) => ws === HOME ? 'owner' : undefined })
  return { fake, list, device }
}

export function fakeAgentd() {
  const files = new Map<string, string>()
  const applied = new Map<string, boolean>()
  const failing = new Set<string>()
  const server = createServer({ allowHalfOpen: true }, (sock) => {
    let raw = ''
    sock.setEncoding('utf8').on('data', (chunk) => {
      raw += chunk
      const lines = raw.split('\n')
      const req = JSON.parse(lines[0] ?? '{}')
      if (req.cmd === 'write' && lines.length < 3) return
      if (lines.length < 2) return
      const key = `${req.id}/${req.path}`
      if (req.cmd === 'write') files.set(key, Buffer.from(lines[1] ?? '', 'base64').toString('utf8'))
      if (req.cmd === 'apply' && !failing.has(req.id)) applied.set(req.id, req.running)
      if (req.cmd === 'rm') applied.delete(req.id)
      const states = Object.fromEntries([...applied].map(([id, running]) => [id, running ? 'running' : 'exited']))
      const replies: Record<string, unknown> = {
        ps: { states }, health: { firewall: true, imageReady: true }, apply: { applied: req.id, change: 'none' }, rm: { removed: req.id }, write: { path: req.path },
        read: { body: files.has(key) ? Buffer.from(files.get(key) ?? '').toString('base64') : null }, skills: { skills: [], bundled: '' }, delete: { removed: req.paths ?? [] },
      }
      if (req.cmd === 'apply' && failing.has(req.id)) return sock.end(JSON.stringify({ ok: false, error: 'Pool overlaps with other one on this address space' }))
      sock.end(JSON.stringify({ ok: true, ...(replies[req.cmd] as object) }))
    })
  }).listen(process.env.AGENTD_SOCK)
  server.unref()
  return { files, applied, failing }
}
