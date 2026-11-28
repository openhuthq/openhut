import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameProblem, runsOnChoices } from '../../../src/features/agents/form.ts'

test('Runs on lists the online computers', () => {
  const on = (id: string, online = true) => ({ id, online })
  assert.deepEqual(runsOnChoices([on('here'), on('mac'), on('box', false)]).map((each) => each.id), ['here', 'mac'])
  assert.deepEqual(runsOnChoices([on('here'), on('box', false)]).map((each) => each.id), ['here'])
  assert.deepEqual(runsOnChoices(undefined), [])
})

test('A name may have any letters, digits and punctuation, but no hidden characters', () => {
  assert.equal(nameProblem('Ops-2 v1.0_beta'), '')
  assert.equal(nameProblem('El Nazer (DB)'), '')
  assert.equal(nameProblem('الناظر!'), '')
  assert.equal(nameProblem('Ops\u200b'), 'This name has hidden characters. Retype it to save.')
})
