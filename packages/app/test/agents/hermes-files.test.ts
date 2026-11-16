import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderFiles, type RenderedChannel } from '../../src/agents/hermes-files.ts'
import { config } from '../../src/platform/config.ts'

const agent = { id: 'ag_chantest', name: 'Dev', instructions: '# Dev', model: 'sonnet', net: 3, code_execution: true }
const render = (channels: RenderedChannel[]) => renderFiles({ agent, ownerName: 'owner', token: 'ag_chantest.token', channelKey: 'k'.repeat(32), seat: '', channels, connections: [] })

test('no channels: approvals are off, no Slack or WhatsApp settings', () => {
  const files = render([])
  assert.match(files['config.yaml'], /approvals:\n {2}mode: "off"\n/)
  assert.doesNotMatch(files['config.yaml'], /approvers/)
  assert.doesNotMatch(files['.env'], /SLACK_|WHATSAPP_/)
})

test('Slack for listed people: tokens, the allowlist with the owner', () => {
  const files = render([{ kind: 'slack', botToken: 'xoxb-1-x', appToken: 'xapp-1-x', audience: { ownerAddress: 'U012ABCDEF', open: false, allowed: ['U034GHIJKL'] } }])
  assert.match(files['.env'], /^SLACK_BOT_TOKEN=xoxb-1-x$/m)
  assert.match(files['.env'], /^SLACK_APP_TOKEN=xapp-1-x$/m)
  assert.match(files['.env'], /^SLACK_ALLOWED_USERS=U012ABCDEF,U034GHIJKL$/m)
  assert.match(files['config.yaml'], /slack:\n {2}require_mention: true\n {2}unauthorized_dm_behavior: ignore/)
})

test('WhatsApp open to anyone: bot mode, everyone allowed, approvals still off', () => {
  const files = render([{ kind: 'whatsapp', audience: { ownerAddress: '+15551234567', open: true, allowed: [] } }])
  assert.match(files['.env'], /^WHATSAPP_ENABLED=true$/m)
  assert.match(files['.env'], /^WHATSAPP_MODE=bot$/m)
  assert.match(files['.env'], /^WHATSAPP_ALLOWED_USERS=\*$/m)
  assert.match(files['config.yaml'], /mode: "off"/)
})

test('Claude mode: the seat plugin is the model, haiku does side tasks, and the seat token goes into .env', (t) => {
  config.modelMode = 'claude'
  t.after(() => { config.modelMode = 'test' })
  const files = renderFiles({ agent, ownerName: 'owner', token: 'ag_chantest.token', channelKey: 'k'.repeat(32), seat: 'sk-ant-oat01-seat', channels: [], connections: [] })
  assert.match(files['config.yaml'], /model:\n {2}default: sonnet\n {2}provider: claude-subscription-directsdk-experimental/)
  assert.match(files['config.yaml'], /approval: \{ provider: claude-subscription-directsdk-experimental, model: haiku \}/)
  assert.doesNotMatch(files['config.yaml'], /test-llm/)
  assert.match(files['.env'], /^CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-seat$/m)
})

test('code execution is on unless the agent switches it off; the browser stays off', () => {
  assert.match(render([])['config.yaml'], /disabled_toolsets: \[browser, delegation, cronjob\]/)
  const off = renderFiles({ agent: { ...agent, code_execution: false }, ownerName: 'owner', token: 't', channelKey: 'k'.repeat(32), seat: '', channels: [], connections: [] })
  assert.match(off['config.yaml'], /disabled_toolsets: \[browser, delegation, cronjob, code_execution\]/)
})

test('Telegram for listed people: the bot token, numeric IDs with the owner, strangers ignored', () => {
  const files = render([{ kind: 'telegram', botToken: '123456789:AAEtoken', audience: { ownerAddress: '111222333', open: false, allowed: ['444555666'] } }])
  assert.match(files['.env'], /^TELEGRAM_BOT_TOKEN=123456789:AAEtoken$/m)
  assert.match(files['.env'], /^TELEGRAM_ALLOWED_USERS=111222333,444555666$/m)
  assert.doesNotMatch(files['.env'], /TELEGRAM_ALLOW_ALL_USERS/)
  assert.match(files['config.yaml'], /telegram:\n {2}require_mention: true\n {2}unauthorized_dm_behavior: ignore/)
})

test('Telegram open to anyone: everyone allowed', () => {
  const files = render([{ kind: 'telegram', botToken: '123456789:AAEtoken', audience: { ownerAddress: '111222333', open: true, allowed: [] } }])
  assert.match(files['.env'], /^TELEGRAM_ALLOW_ALL_USERS=true$/m)
  assert.doesNotMatch(files['.env'], /TELEGRAM_ALLOWED_USERS/)
})

test('SOUL.md names the connected apps in one line, and stays the instructions alone when there are none', () => {
  assert.equal(render([])['SOUL.md'], '# Dev\n')
  const files = renderFiles({ agent, ownerName: 'owner', token: 't', channelKey: 'k'.repeat(32), seat: '', channels: [], connections: [{ name: 'Excalidraw', kind: 'excalidraw' }, { name: 'Orders\nDB', kind: 'postgres' }] })
  assert.equal(files['SOUL.md'], '# Dev\n\n## Connected apps\n\nThe openhut tools reach: Excalidraw, Orders DB (postgres). Call list_tools to see what each one does, and use it before doing the same work by hand.\n')
})
