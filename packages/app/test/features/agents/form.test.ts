import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runsOnChoices } from '../../../src/features/agents/form.ts'

test('Runs on lists the online computers', () => {
  const on = (id: string, online = true) => ({ id, online })
  assert.deepEqual(runsOnChoices([on('here'), on('mac'), on('box', false)]).map((each) => each.id), ['here', 'mac'])
  assert.deepEqual(runsOnChoices([on('here'), on('box', false)]).map((each) => each.id), ['here'])
  assert.deepEqual(runsOnChoices(undefined), [])
})
