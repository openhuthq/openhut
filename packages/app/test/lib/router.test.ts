import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inAppPath } from '../../src/lib/router.ts'

const link = (href: string, here: string, more: { target?: string; download?: boolean } = {}) => inAppPath({ href, target: more.target ?? '', download: more.download ?? false, here })

test('a link to a screen stays in the page on every origin the app runs on', () => {
  assert.equal(link('/agents/ag_1', 'https://app.openhut.dev/'), '/agents/ag_1')
  assert.equal(link('/agents/ag_1/memory', 'https://localhost/agents/ag_1'), '/agents/ag_1/memory')
  assert.equal(link('/connections?open=pg', 'http://localhost:5173/'), '/connections?open=pg')
})

test('links that leave the app, open elsewhere, download or only jump to a hash are left to the browser', () => {
  assert.equal(link('https://slack.com/apps', 'https://app.openhut.dev/'), undefined)
  assert.equal(link('mailto:help@openhut.dev', 'https://app.openhut.dev/'), undefined)
  assert.equal(link('/api/threads/th_1/files?path=a', 'https://app.openhut.dev/agents/ag_1'), undefined)
  assert.equal(link('/settings/models', 'https://app.openhut.dev/', { target: '_blank' }), undefined)
  assert.equal(link('/report.csv', 'https://app.openhut.dev/', { download: true }), undefined)
  assert.equal(link('#top', 'https://app.openhut.dev/agents/ag_1'), undefined)
  assert.equal(link('', 'https://app.openhut.dev/'), undefined)
})
