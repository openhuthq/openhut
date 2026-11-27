import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { starterInstructions } from '@openhut/common/asks/ask.ts'
import { render } from '../../../src/adapters/hermes/render.ts'
import type { AgentCtx } from '../../../src/core/agent.ts'
import { config } from '../../../src/server/platform/config.ts'
import { resolveSlots } from '../../../src/server/models/model-slots.ts'

const FIXTURE = new URL('./golden.json', import.meta.url)
const on = (id: string, tier: 'big' | 'fast' = 'big', contextLength: number | null = null) => ({ id, name: id, on: true, tier, note: null, contextLength, inputPrice: null, outputPrice: null })
const catalogs = {
  claude: [on('opus'), on('sonnet'), on('haiku', 'fast')],
  codex: [on('gpt-5.5'), on('gpt-5.5-mini', 'fast')],
  openrouter: [on('anthropic/claude-opus-5.5', 'big', 500000), on('google/gemini-3.5-flash', 'fast', 1000000)],
  openai: [on('gpt-5.5'), on('gpt-5.5-mini', 'fast')],
  compatible: [],
  openhut: [],
}
const slots = (model: string) => resolveSlots({ model, catalog: (provider) => catalogs[provider] })
const agent = { id: 'ag_golden00', name: 'Dev', instructions: '# Dev\n\nShip it.', slots: slots('claude:sonnet'), net: 7, code_execution: true, web_browser: false }
const base = { agent, token: 'ag_golden00.token', channelKey: 'k'.repeat(32), channels: [], connections: [], secrets: [] }
const audience = (allowed: string[], open = false) => ({ ownerAddress: '+15551234567', open, allowed })
const cases: Record<string, { mode: 'test' | 'claude'; ctx: Omit<AgentCtx, 'gateway'> }> = {
  minimal: { mode: 'test', ctx: base },
  everything: {
    mode: 'test',
    ctx: {
      ...base,
      agent: { ...agent, code_execution: false, web_browser: true, notify: JSON.stringify({ default: { platform: 'slack', chat_id: 'C012ABCDEF', chat_name: 'deploys' }, rules: 'Tell me when a deploy fails.' }) },
      channels: [
        { kind: 'slack', audience: audience(['C012ABCDEF', 'G034GHIJKL']) },
        { kind: 'telegram', audience: audience(['123456789']) },
        { kind: 'discord', audience: audience(['1234567890123456789']) },
        { kind: 'whatsapp', audience: audience([], true) },
      ],
      connections: [{ name: 'GitHub', kind: 'github' }, { name: 'Linear', kind: 'linear' }],
      secrets: [{ name: 'STRIPE_KEY', hosts: ['api.stripe.com'] }],
    },
  },
  starter: { mode: 'test', ctx: { ...base, agent: { ...agent, instructions: starterInstructions('Dev') } } },
  claude: { mode: 'claude', ctx: base },
  openrouter: { mode: 'claude', ctx: { ...base, agent: { ...agent, slots: slots('openrouter:anthropic/claude-opus-5.5') } } },
}

function rendered(): Record<string, unknown> {
  const before = { mode: config.modelMode, version: config.version }
  try {
    config.version = '0.0.0-golden'
    return Object.fromEntries(Object.entries(cases).map(([name, { mode, ctx }]) => {
      config.modelMode = mode
      return [name, render(ctx)]
    }))
  } finally {
    config.modelMode = before.mode
    config.version = before.version
  }
}

if (process.env.WRITE_GOLDEN) writeFileSync(FIXTURE, `${JSON.stringify(rendered(), null, 2)}\n`)

test('every plugin renders the same Hermes files as the golden copy', () => {
  assert.deepEqual(rendered(), JSON.parse(readFileSync(FIXTURE, 'utf8')))
})
