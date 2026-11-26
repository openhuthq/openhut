import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activity } from '../../../src/server/gateway/activity.ts'

test('an agent in a turn is not quiet, even with no gateway call for longer than the quiet time, until the turn ends', async () => {
  activity.turn({ agentId: 'ag_longcmd1', turn: 'tu_1', state: 'start' })
  let done = false
  const quiet = activity.quiet({ agentId: 'ag_longcmd1', ms: 50, most: 10_000 }).then(() => { done = true })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal(done, false)
  activity.turn({ agentId: 'ag_longcmd1', turn: 'tu_1', state: 'end' })
  await quiet
  assert.equal(activity.inTurn('ag_longcmd1'), false)
})

test('a turn whose end never came stops holding a restart once the wait reaches its maximum', async () => {
  activity.turn({ agentId: 'ag_lostend1', turn: 'tu_2', state: 'start' })
  const started = Date.now()
  await activity.quiet({ agentId: 'ag_lostend1', ms: 0, most: 1200 })
  assert.ok(Date.now() - started >= 1200)
  assert.equal(activity.inTurn('ag_lostend1'), true)
})

test('an end for a turn that never started changes nothing', () => {
  activity.turn({ agentId: 'ag_strayend', turn: 'tu_3', state: 'end' })
  assert.equal(activity.inTurn('ag_strayend'), false)
})
