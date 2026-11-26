import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeWebhook } from '../../src/webhooks/summary.ts'

test('a DigitalOcean alert (CloudEvents) shows the rule, the droplet, its severity, value, state and a link', () => {
  const alert = {
    specversion: '1.0', id: 'evt_1', source: 'digitalocean.com/monitoring', type: 'com.digitalocean.monitoring.alert.triggered', time: '2026-11-26T10:00:00Z',
    data: { alert_rule_name: 'CPU above 90%', severity: 'SEVERITY_CRITICAL', value: '97.2%', state: 'STATE_ALERTING', resource_name: 'web-01', resource_url: 'https://cloud.digitalocean.com/droplets/1', extra: { nested: true } },
  }
  assert.deepEqual(summarizeWebhook(alert), {
    title: 'CPU above 90%', subtitle: 'web-01', severity: 'critical',
    fields: [{ label: 'Value', value: '97.2%' }, { label: 'State', value: 'Alerting' }, { label: 'Since', value: '2026-11-26T10:00:00Z' }],
    link: { label: 'Open in DigitalOcean', url: 'https://cloud.digitalocean.com/droplets/1' },
    event: 'com.digitalocean.monitoring.alert.triggered',
  })
})

test('a GitHub pull request event names the PR, the repository, the action and who did it', () => {
  const summary = summarizeWebhook({
    action: 'opened', number: 7, repository: { full_name: 'acme/api', html_url: 'https://github.com/acme/api' }, sender: { login: 'ana' },
    pull_request: { number: 7, title: 'Fix login', html_url: 'https://github.com/acme/api/pull/7' },
  })
  assert.deepEqual(summary, {
    title: '#7 Fix login', subtitle: 'acme/api',
    fields: [{ label: 'Pull request', value: 'Opened' }, { label: 'By', value: 'ana' }],
    link: { label: 'Open in GitHub', url: 'https://github.com/acme/api/pull/7' }, event: 'pull_request.opened',
  })
})

test('a GitHub push says how many commits went where', () => {
  const summary = summarizeWebhook({ ref: 'refs/heads/main', commits: [{}, {}], compare: 'https://github.com/acme/api/compare/a...b', repository: { full_name: 'acme/api' }, sender: { login: 'bo' } })
  assert.equal(summary.title, 'Pushed 2 commits to main')
  assert.equal(summary.link?.url, 'https://github.com/acme/api/compare/a...b')
})

test('anything else shows its event name and its first three plain fields, skipping objects and unsafe links', () => {
  const summary = summarizeWebhook({ event: 'order.paid', order: { id: 1 }, amount: 42, currency: 'EUR', paid: true, customer: 'Ana', url: 'javascript:alert(1)', level: 'warning' })
  assert.deepEqual(summary, {
    title: 'Order paid', severity: 'warning',
    fields: [{ label: 'Amount', value: '42' }, { label: 'Currency', value: 'EUR' }, { label: 'Paid', value: 'true' }],
    event: 'order.paid',
  })
})

test('a body that is not JSON shows as text, clipped, and an empty one still has a title', () => {
  assert.deepEqual(summarizeWebhook('hello'), { title: 'Webhook called', fields: [{ label: 'Body', value: 'hello' }] })
  assert.equal(summarizeWebhook('x'.repeat(500)).fields[0].value.length, 200)
  assert.deepEqual(summarizeWebhook(''), { title: 'Webhook called', fields: [] })
  assert.deepEqual(summarizeWebhook([1, 2]), { title: 'Webhook called', fields: [] })
})
