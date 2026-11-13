import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderFiles, type RenderedChannel } from '../../src/agents/hermes-files.ts'

const agent = { id: 'ag_chantest', name: 'Dev', instructions: '# Dev', model: 'sonnet', net: 3 }
const render = (channels: RenderedChannel[]) => renderFiles({ agent, ownerName: 'owner', token: 'ag_chantest.token', channelKey: 'k'.repeat(32), seat: '', channels })

test('no channels: manual approvals by the owner, no Slack or WhatsApp settings', () => {
  const files = render([])
  assert.match(files['config.yaml'], /mode: manual\n {2}approvers: \["owner"\]/)
  assert.doesNotMatch(files['.env'], /SLACK_|WHATSAPP_/)
})

test('Slack for listed people: tokens, the allowlist with the owner, approvals to the owner\'s Slack ID', () => {
  const files = render([{ kind: 'slack', botToken: 'xoxb-1-x', appToken: 'xapp-1-x', audience: { ownerAddress: 'U012ABCDEF', open: false, allowed: ['U034GHIJKL'] } }])
  assert.match(files['.env'], /^SLACK_BOT_TOKEN=xoxb-1-x$/m)
  assert.match(files['.env'], /^SLACK_APP_TOKEN=xapp-1-x$/m)
  assert.match(files['.env'], /^SLACK_ALLOWED_USERS=U012ABCDEF,U034GHIJKL$/m)
  assert.match(files['config.yaml'], /slack:\n {2}require_mention: true\n {2}unauthorized_dm_behavior: ignore/)
  assert.match(files['config.yaml'], /approvers: \["owner","U012ABCDEF"\]/)
  assert.match(files['config.yaml'], /mode: manual/)
})

test('WhatsApp open to anyone: bot mode, everyone allowed, smart approvals, the owner\'s WhatsApp approves', () => {
  const files = render([{ kind: 'whatsapp', audience: { ownerAddress: '+15551234567', open: true, allowed: [] } }])
  assert.match(files['.env'], /^WHATSAPP_ENABLED=true$/m)
  assert.match(files['.env'], /^WHATSAPP_MODE=bot$/m)
  assert.match(files['.env'], /^WHATSAPP_ALLOWED_USERS=\*$/m)
  assert.match(files['config.yaml'], /mode: smart/)
  assert.match(files['config.yaml'], /"15551234567@s\.whatsapp\.net"/)
})

test('the gateway is the agent\'s own .1 on the gateway port', () => {
  assert.match(render([])['config.yaml'], /url: http:\/\/10\.200\.3\.1:8081\/api\/v1\/mcp/)
})
