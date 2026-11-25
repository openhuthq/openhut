import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { agentd } from '../../../src/server/platform/agentd.ts'
import { forward } from '../../../src/server/relay/forward.ts'
import { fakeComputer } from './fake-computer.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_fwdowner', email: 'fwd@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_onbuild1', name: 'Builder', owner_id: 'usr_fwdowner', instructions: '# B', model: 'claude:sonnet', net: 3, channel_key: seal('k'.repeat(32)), runs_on: 'cm_buildbox' }).execute()
const FILES = { 'config.yaml': 'a', '.env': 'b', 'SOUL.md': 'c', 'auth.json': 'd' }

test('a call for an agent goes to the computer that runs it, and only there', async () => {
  const build = fakeComputer({ id: 'cm_buildbox' })
  const other = fakeComputer({ id: 'cm_otherbox' })
  await agentd.apply({ id: 'ag_onbuild1', net: 3, files: FILES, browser: false, running: true })
  assert.equal(build.agentd.applied.get('ag_onbuild1'), true)
  assert.equal(other.agentd.applied.has('ag_onbuild1'), false)
  assert.deepEqual(build.opened, [{ to: 'agentd' }])
})

test('the newest connection for a computer wins; the older one is ended and its close changes nothing', () => {
  const first = fakeComputer({ id: 'cm_twinsbox' })
  const second = fakeComputer({ id: 'cm_twinsbox' })
  assert.equal(first.ended.count, 1)
  assert.equal(forward.linked('cm_twinsbox'), second.link)
  forward.unlink({ computer: 'cm_twinsbox', link: first.link })
  assert.equal(forward.linked('cm_twinsbox'), second.link)
})

test('an agent on a computer that isn\'t connected gets a clear 503', async () => {
  await db.updateTable('agent').set({ runs_on: 'cm_goneaway' }).where('id', '=', 'ag_onbuild1').execute()
  await assert.rejects(agentd.stop({ id: 'ag_onbuild1' }), { status: 503, message: /offline/ })
})
