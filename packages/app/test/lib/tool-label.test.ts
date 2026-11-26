import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plainKey, toolLabel, toolSentence } from '../../src/lib/tool-label.ts'

test('tool names read as plain actions', () => {
  assert.equal(toolLabel('db-cluster-update-psql-config'), 'Changed database settings')
  assert.equal(toolLabel('db-cluster-update-psql-config', 'now'), 'change database settings')
  assert.equal(toolLabel('insights-alert-rule-create'), 'Created a metrics alert')
  assert.equal(toolLabel('db-cluster-delete', 'now'), 'delete a database')
  assert.equal(toolLabel('save_issue'), 'Saved a ticket')
  assert.equal(toolLabel('db-cluster-list'), 'Listed databases')
  assert.equal(toolLabel('db-health-runbook'), 'Database health runbook')
  assert.equal(toolLabel('dashboard.stripe.com'), 'Opened dashboard.stripe.com')
  assert.equal(toolSentence('db-health-runbook'), 'Used database health runbook')
  assert.equal(toolSentence('postgres_query'), 'Checked postgres')
  assert.equal(plainKey('config.max_connections'), 'Connection limit')
})
