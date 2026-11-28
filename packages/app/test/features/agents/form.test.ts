import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameProblem, runsOnChoices } from '../../../src/features/agents/form.ts'

test('Runs on lists the online computers', () => {
  const on = (id: string, online = true) => ({ id, online })
  assert.deepEqual(runsOnChoices([on('here'), on('mac'), on('box', false)]).map((each) => each.id), ['here', 'mac'])
  assert.deepEqual(runsOnChoices([on('here'), on('box', false)]).map((each) => each.id), ['here'])
  assert.deepEqual(runsOnChoices(undefined), [])
})

test('A name lists the characters it can’t have', () => {
  assert.equal(nameProblem('Ops-2 v1.0_beta'), '')
  assert.equal(nameProblem('El Nazer (DB)'), 'Names can’t have ( ). Remove them to save.')
  assert.equal(nameProblem('Ops!'), 'Names can’t have !. Remove it to save.')
})
