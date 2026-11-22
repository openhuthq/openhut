import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { hasTeam, visibleTeams } from '../../../src/features/cloud/teams.ts'

const member = (email: string) => ({ email, role: 'member' }) as CloudWorkspaceView['members'][number]
const team = (id: string, more: Partial<CloudWorkspaceView> = {}) => ({ id, name: id, website: null, home: false, own: false, role: 'member', waiting: false, members: [member('sara@x.com')], invites: [], requests: [], names: {}, ...more }) as CloudWorkspaceView
const sara = team('sara', { home: true, own: true, role: 'owner' })
const mo = team('mo', { members: [member('mo@x.com'), member('sara@x.com')] })
const ids = (list: CloudWorkspaceView[]) => list.map((each) => each.id)

test('after joining a team, an empty own workspace is hidden and the joined team has no Create', () => {
  const visible = visibleTeams({ workspaces: [sara, mo], agents: [] })
  assert.deepEqual(ids(visible), ['mo'])
  assert.equal(hasTeam(visible), true)
})

test('the own workspace stays when it is the only one, and then Create shows', () => {
  assert.deepEqual(ids(visibleTeams({ workspaces: [sara], agents: [] })), ['sara'])
  assert.equal(hasTeam([sara]), false)
})

test('the own workspace stays when it has an agent, a person or an invite, or before agents load', () => {
  const kept = [
    visibleTeams({ workspaces: [sara, mo], agents: [{ computer: 'local', workspace: null }] }),
    visibleTeams({ workspaces: [sara, mo], agents: [{ computer: 'local', workspace: 'sara' }] }),
    visibleTeams({ workspaces: [sara, mo], agents: [{ computer: 'server', workspace: null }] }),
    visibleTeams({ workspaces: [{ ...sara, members: [member('sara@x.com'), member('tom@x.com')] }, mo], agents: [] }),
    visibleTeams({ workspaces: [{ ...sara, invites: [{ email: 'tom@x.com', role: 'member', link: null }] }, mo], agents: [] }),
    visibleTeams({ workspaces: [sara, mo], agents: undefined }),
  ]
  for (const visible of kept) assert.deepEqual(ids(visible), ['sara', 'mo'])
  assert.deepEqual(ids(visibleTeams({ workspaces: [sara, mo], agents: [{ computer: 'local', workspace: 'mo' }] })), ['mo'])
})
