import { createServer } from 'node:net'
import type { AgentRecord, ControlRecord } from '@openhut/common/agents/agent.ts'
import type { ChannelRecord } from '@openhut/common/channels/channel.ts'
import type { RoutineRecord } from '@openhut/common/routines/routine.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { audienceOf } from '../../../src/server/channels/audience.ts'
import { db } from '../../../src/server/platform/db.ts'
import { recordsService } from '../../../src/server/platform/records.ts'
import { unseal } from '../../../src/server/platform/secrets.ts'
import { HERE, HOME } from '../../../src/server/team/home.ts'
import { useFakeRecords } from './records-fake.ts'

export { HOME }

export function signIn(_: { email?: string } = {}) {
  const device = { me: HERE }
  const fake = useFakeRecords({ by: HERE })
  return { fake, device }
}

let seeded = false

export async function refresh(): Promise<void> {
  if (!seeded) await seed()
  seeded = true
  await runSet.refresh()
}

async function seed(): Promise<void> {
  const iso = (value: Date | string | null): string | null => value ? new Date(value).toISOString() : null
  for (const row of await db.selectFrom('agent as a').innerJoin('person as p', 'p.id', 'a.owner_id').selectAll('a').select('p.email').orderBy('a.created_at').execute()) {
    const place = { workspace: HOME, parent: row.id, personal: !row.shared }
    const value: AgentRecord = { name: row.name, instructions: row.instructions, face: row.face, wanted: row.wanted, createdAt: new Date(row.created_at).toISOString() }
    await recordsService.put({ collection: 'agent', id: row.id, workspace: HOME, parent: row.owner ?? row.email, personal: !row.shared, value })
    const grants = await db.selectFrom('connection_grant').select(['connection_id', 'created_at']).where('agent_id', '=', row.id).execute()
    const control: ControlRecord = { runsOn: HERE, model: row.model, codeExecution: row.code_execution, browser: row.web_browser, grants: grants.map((grant) => ({ connection: grant.connection_id, at: new Date(grant.created_at).toISOString() })), people: [], sidebars: [] }
    await recordsService.put({ collection: 'control', ...place, value: control })
    for (const channel of await db.selectFrom('channel').selectAll().where('agent_id', '=', row.id).execute()) {
      const record: ChannelRecord = { kind: channel.kind, status: channel.status, account: channel.account, ...audienceOf(channel), createdAt: new Date(channel.created_at).toISOString() }
      await recordsService.put({ collection: 'channel', id: channel.id, ...place, value: record, ...channel.secrets && { secret: JSON.parse(unseal(channel.secrets)) } })
    }
    for (const routine of await db.selectFrom('routine').selectAll().where('agent_id', '=', row.id).execute()) {
      const record: RoutineRecord = { name: routine.name, plan: routine.plan, at: iso(routine.at), cron: routine.cron, until: iso(routine.until), origin: routine.origin, createdAt: new Date(routine.created_at).toISOString() }
      await recordsService.put({ collection: 'routine', id: routine.id, ...place, value: record })
    }
  }
}

export function fakeAgentd({ path = process.env.AGENTD_SOCK }: { path?: string } = {}) {
  const files = new Map<string, string>()
  const applied = new Map<string, boolean>()
  const failing = new Set<string>()
  const features = { whatsapp: false, browser: false }
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
      if (req.cmd === 'stop' && applied.has(req.id)) applied.set(req.id, false)
      const states = Object.fromEntries([...applied].map(([id, running]) => [id, running ? 'running' : 'exited']))
      const replies: Record<string, unknown> = {
        ps: { states }, health: { firewall: true, imageReady: true, features }, apply: { applied: req.id, change: 'none' }, rm: { removed: req.id }, stop: { stopped: req.id }, write: { path: req.path },
        read: { body: files.has(key) ? Buffer.from(files.get(key) ?? '').toString('base64') : null }, skills: { skills: [], bundled: '' }, delete: { removed: req.paths ?? [] },
      }
      if (req.cmd === 'apply' && failing.has(req.id)) return sock.end(JSON.stringify({ ok: false, error: 'Pool overlaps with other one on this address space' }))
      sock.end(JSON.stringify({ ok: true, ...(replies[req.cmd] as object) }))
    })
  }).listen(path)
  server.unref()
  return { files, applied, failing, features }
}
