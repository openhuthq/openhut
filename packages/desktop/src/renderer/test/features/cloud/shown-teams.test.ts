import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { shownTeams } from '../../../src/features/cloud/shown-teams.ts'

const team = (id: string, more: Partial<CloudWorkspaceView> = {}): CloudWorkspaceView => ({ id, name: id, website: null, home: false, own: false, role: 'member', waiting: false, members: [{ email: 'sara@example.com', role: 'owner', devices: [], viewers: [] }], invites: [], requests: [], names: {}, ...more } as CloudWorkspaceView)

test('an invited person sees only the team they joined, until their own team has an agent or someone else', () => {
  const own = team('ws_sara', { home: true, own: true, role: 'owner' })
  const mos = team('ws_mo', { members: [own.members[0], { email: 'mo@example.com', role: 'owner', devices: [], viewers: [] }] as CloudWorkspaceView['members'] })
  assert.deepEqual(shownTeams({ all: [own, mos], active: 'ws_mo', homeAgents: 0 }).map((each) => each.id), ['ws_mo'])
  assert.deepEqual(shownTeams({ all: [own, mos], active: 'ws_mo', homeAgents: 1 }).map((each) => each.id), ['ws_sara', 'ws_mo'])
  assert.deepEqual(shownTeams({ all: [own, mos], active: 'ws_sara', homeAgents: 0 }).map((each) => each.id), ['ws_sara', 'ws_mo'])
  assert.deepEqual(shownTeams({ all: [own], active: 'ws_sara', homeAgents: 0 }).map((each) => each.id), ['ws_sara'])
})
