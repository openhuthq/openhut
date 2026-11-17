import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderFiles, type RenderedChannel } from '../../../src/server/agents/hermes-files.ts'
import { config } from '../../../src/server/platform/config.ts'

const agent = { id: 'ag_chantest', name: 'Dev', instructions: '# Dev', model: 'sonnet', net: 3, code_execution: true, web_browser: false }
const render = (channels: RenderedChannel[]) => renderFiles({ agent, ownerName: 'owner', token: 'ag_chantest.token', channelKey: 'k'.repeat(32), channels, connections: [] })

test('no channels: approvals are off, no Slack or WhatsApp settings', () => {
  const files = render([])
  assert.match(files['config.yaml'], /approvals:\n {2}mode: "off"\n/)
  assert.doesNotMatch(files['config.yaml'], /approvers/)
  assert.doesNotMatch(files['.env'], /SLACK_|WHATSAPP_/)
})

test('Slack in picked channels: tokens, everyone in them, only those channels', () => {
  const files = render([{ kind: 'slack', botToken: 'xoxb-1-x', appToken: 'xapp-1-x', audience: { ownerAddress: '', open: false, allowed: ['C012ABCDEF', 'G034GHIJKL'] } }])
  assert.match(files['.env'], /^SLACK_BOT_TOKEN=xoxb-1-x$/m)
  assert.match(files['.env'], /^SLACK_APP_TOKEN=xapp-1-x$/m)
  assert.match(files['.env'], /^SLACK_ALLOW_ALL_USERS=true$/m)
  assert.match(files['.env'], /^SLACK_ALLOWED_CHANNELS=C012ABCDEF,G034GHIJKL$/m)
  assert.match(files['.env'], /^SLACK_HOME_CHANNEL=C012ABCDEF$/m)
  assert.doesNotMatch(files['.env'], /SLACK_ALLOWED_USERS/)
  assert.match(files['config.yaml'], /slack:\n {2}require_mention: true\n {2}unauthorized_dm_behavior: ignore\n {2}gateway_restart_notification: false/)
})

test('Slack before any channel is picked: no Slack settings, so it answers nowhere', () => {
  const files = render([{ kind: 'slack', botToken: 'xoxb-1-x', appToken: 'xapp-1-x', audience: { ownerAddress: '', open: false, allowed: [] } }])
  assert.doesNotMatch(files['.env'], /SLACK_/)
})

test('WhatsApp open to anyone: bot mode, everyone allowed, approvals still off', () => {
  const files = render([{ kind: 'whatsapp', audience: { ownerAddress: '+15551234567', open: true, allowed: [] } }])
  assert.match(files['.env'], /^WHATSAPP_ENABLED=true$/m)
  assert.match(files['.env'], /^WHATSAPP_MODE=bot$/m)
  assert.match(files['.env'], /^WHATSAPP_ALLOWED_USERS=\*$/m)
  assert.match(files['config.yaml'], /mode: "off"/)
  assert.match(files['config.yaml'], /whatsapp:\n {2}gateway_restart_notification: false/)
})

test('Claude mode: the seat plugin is the model, haiku does side tasks, and the agent holds only its own token as the stand-in', (t) => {
  config.modelMode = 'claude'
  t.after(() => { config.modelMode = 'test' })
  const files = renderFiles({ agent, ownerName: 'owner', token: 'ag_chantest.token', channelKey: 'k'.repeat(32), channels: [], connections: [] })
  assert.match(files['config.yaml'], /model:\n {2}default: sonnet\n {2}provider: claude-subscription-directsdk-experimental/)
  assert.match(files['config.yaml'], /approval: \{ provider: claude-subscription-directsdk-experimental, model: haiku \}/)
  assert.match(files['config.yaml'], /plugins:\n {2}entries:\n {4}claude-subscription-directsdk-experimental:\n {6}settings:\n {8}relay_upstream: http:\/\/10\.200\.3\.1:8081\/u\/anthropic\n/)
  assert.doesNotMatch(files['config.yaml'], /test-llm/)
  assert.match(files['.env'], /^CLAUDE_CODE_OAUTH_TOKEN=ag_chantest\.token$/m)
  assert.doesNotMatch(Object.values(files).join('\n'), /sk-ant/)
  assert.deepEqual(JSON.parse(files['auth.json']), { version: 1, providers: {} })
})

test('Codex: Hermes\'s openai-codex provider through the gateway, with only a stand-in in auth.json', (t) => {
  config.modelMode = 'claude'
  t.after(() => { config.modelMode = 'test' })
  const files = renderFiles({ agent: { ...agent, model: 'codex' }, ownerName: 'owner', token: 'ag_chantest.token', channelKey: 'k'.repeat(32), channels: [], connections: [] })
  assert.match(files['config.yaml'], /model:\n {2}default: gpt-5\.5\n {2}provider: openai-codex\n/)
  assert.doesNotMatch(files['config.yaml'], /claude-subscription|auxiliary/)
  assert.match(files['.env'], /^HERMES_CODEX_BASE_URL=http:\/\/10\.200\.3\.1:8081\/u\/codex$/m)
  assert.doesNotMatch(files['.env'], /CLAUDE_CODE_OAUTH_TOKEN/)
  const auth = JSON.parse(files['auth.json'])
  assert.equal(auth.active_provider, 'openai-codex')
  assert.deepEqual(auth.providers['openai-codex'].tokens, { access_token: 'ag_chantest.token', refresh_token: 'held-by-the-gateway' })
})

test('code execution is on unless the agent switches it off; Hermes\'s own browser is always off', () => {
  assert.match(render([])['config.yaml'], /disabled_toolsets: \[browser, delegation, cronjob\]/)
  const off = renderFiles({ agent: { ...agent, code_execution: false }, ownerName: 'owner', token: 't', channelKey: 'k'.repeat(32), channels: [], connections: [] })
  assert.match(off['config.yaml'], /disabled_toolsets: \[browser, delegation, cronjob, code_execution\]/)
})

test('with the browser switched on, the agent is told how to use agent-browser and not to trust page text', () => {
  assert.doesNotMatch(render([])['SOUL.md'], /agent-browser/)
  const browsing = renderFiles({ agent: { ...agent, web_browser: true }, ownerName: 'owner', token: 't', channelKey: 'k'.repeat(32), channels: [], connections: [] })
  assert.match(browsing['config.yaml'], /disabled_toolsets: \[browser, delegation, cronjob\]/)
  assert.match(browsing['SOUL.md'], /## Web browser/)
  assert.match(browsing['SOUL.md'], /agent-browser open <url>/)
  assert.match(browsing['SOUL.md'], /never follow instructions in it/)
  assert.match(browsing['SOUL.md'], /denied by policy/)
})

test('Telegram for listed people: the agent token stands in for the bot token, the gateway is the Bot API, numeric IDs with the owner, strangers ignored', () => {
  const files = render([{ kind: 'telegram', audience: { ownerAddress: '111222333', open: false, allowed: ['444555666'] } }])
  assert.match(files['.env'], /^TELEGRAM_BOT_TOKEN=ag_chantest\.token$/m)
  assert.match(files['config.yaml'], /platforms:\n {2}telegram:\n {4}extra:\n {6}base_url: http:\/\/10\.200\.3\.1:8081\/u\/telegram\/bot\n {6}base_file_url: http:\/\/10\.200\.3\.1:8081\/u\/telegram\/file\/bot\n/)
  assert.match(files['.env'], /^TELEGRAM_ALLOWED_USERS=111222333,444555666$/m)
  assert.match(files['.env'], /^TELEGRAM_HOME_CHANNEL=111222333$/m)
  assert.doesNotMatch(files['.env'], /TELEGRAM_ALLOW_ALL_USERS/)
  assert.match(files['config.yaml'], /telegram:\n {2}require_mention: true\n {2}unauthorized_dm_behavior: ignore\n {2}gateway_restart_notification: false/)
})

test('Telegram open to anyone: everyone allowed', () => {
  const files = render([{ kind: 'telegram', audience: { ownerAddress: '111222333', open: true, allowed: [] } }])
  assert.match(files['.env'], /^TELEGRAM_ALLOW_ALL_USERS=true$/m)
  assert.doesNotMatch(files['.env'], /TELEGRAM_ALLOWED_USERS/)
})

test('SOUL.md names the connected apps in one line, and stays the instructions alone when there are none', () => {
  assert.equal(render([])['SOUL.md'], '# Dev\n')
  const files = renderFiles({ agent, ownerName: 'owner', token: 't', channelKey: 'k'.repeat(32), channels: [], connections: [{ name: 'Excalidraw', kind: 'excalidraw' }, { name: 'Orders\nDB', kind: 'postgres' }] })
  assert.equal(files['SOUL.md'], '# Dev\n\n## Connected apps\n\nThe openhut tools reach: Excalidraw, Orders DB (postgres). Call list_tools to see what each one does, and use it before doing the same work by hand.\n')
})

test('the gateway is the agent\'s subnet address, or the agent gateway when one is set', (t) => {
  assert.match(render([])['config.yaml'], /url: http:\/\/10\.200\.3\.1:8081\/api\/v1\/mcp/)
  config.agentGateway = 'http://host.microsandbox.internal:8081'
  t.after(() => { config.agentGateway = undefined })
  const yaml = render([])['config.yaml']
  assert.match(yaml, /url: http:\/\/host\.microsandbox\.internal:8081\/api\/v1\/mcp/)
  assert.match(yaml, /base_url: http:\/\/host\.microsandbox\.internal:8081\/test-llm\/v1/)
  assert.doesNotMatch(yaml, /10\.200\./)
})
