import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readable } from '../../../src/features/agents/skill-text.ts'

test('the rendered body drops the frontmatter and a first heading that repeats the name', () => {
  assert.equal(readable({ body: '---\nname: late-invoices\n---\n\n# Late invoices\n\n1. Query.\n', name: 'late-invoices' }), '1. Query.\n')
  assert.equal(readable({ body: '# blocked-page-recovery\nUse it.', name: 'blocked-page-recovery' }), 'Use it.')
})

test('a first heading that says something else stays', () => {
  assert.equal(readable({ body: '---\nname: x\n---\n# When to use\nAlways.', name: 'x' }), '# When to use\nAlways.')
  assert.equal(readable({ body: 'No heading.', name: 'x' }), 'No heading.')
})
