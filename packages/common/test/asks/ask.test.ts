import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileSpecStream } from '@json-render/core'
import { askCard, askedPath, askPath, isStarter, OPEN_PAGE, starterInstructions } from '../../src/asks/ask.ts'
import { parseCard, SPEC_BLOCK } from '../../src/cards/card.ts'

test('askPath opens the connect sheet for the app, for the agent that asked', () => {
  assert.equal(askPath({ agentId: 'ag_1', app: 'postgres' }), '/connections/new/postgres?for=ag_1')
  assert.equal(askPath({ agentId: 'ag_1', app: 'mcp', url: 'https://mcp.digitalocean.com/mcp', name: 'DigitalOcean' }),
    '/connections/new/mcp?for=ag_1&url=https%3A%2F%2Fmcp.digitalocean.com%2Fmcp&name=DigitalOcean')
})

test('askedPath reads back only connect sheets on the open page', () => {
  assert.equal(askedPath(`${OPEN_PAGE}#/connections/new/github?for=ag_1`), '/connections/new/github?for=ag_1')
  assert.equal(askedPath(`${OPEN_PAGE}#/agents/ag_1/memory?x=1`), undefined)
  assert.equal(askedPath(`${OPEN_PAGE}#/connections/new/oracle?for=ag_1`), undefined)
  assert.equal(askedPath('https://evil.example/open#/connections/new/github?for=ag_1'), undefined)
  assert.equal(askedPath(`${OPEN_PAGE}#/connections/new/github?for=ag_1&error=Paste+your+key+again`), undefined)
})

const cardOf = (block: string) => parseCard(compileSpecStream(SPEC_BLOCK.exec(block)?.[1] ?? ''))

test('askCard lists every app in one valid card, each with its own Connect', () => {
  const card = cardOf(askCard({ why: 'One short sign-in each.', asks: [
    { agentId: 'ag_1', app: 'postgres', line: 'read your database to spot slow queries' },
    { agentId: 'ag_1', app: 'github', line: 'open pull requests with fixes' },
    { agentId: 'ag_1', app: 'linear' },
  ] }))
  assert.ok(card)
  assert.deepEqual(card.elements.ask, { type: 'Card', props: { title: 'Connect apps' }, children: ['why', 'app0', 'app1', 'app2'] })
  assert.deepEqual(card.elements.app0.props, { title: 'Postgres', brand: 'postgres', subtitle: 'read your database to spot slow queries', url: `${OPEN_PAGE}#/connections/new/postgres?for=ag_1` })
  assert.equal(card.elements.app2.props.url, `${OPEN_PAGE}#/connections/new/linear?for=ag_1`)
})

test('askCard names a single app in its title and brands MCP servers by their real host', () => {
  assert.equal(cardOf(askCard({ why: 'x', asks: [{ agentId: 'ag_1', app: 'postgres' }] }))?.elements.ask.props.title, 'Connect Postgres')
  const cloudflare = cardOf(askCard({ why: 'Logs.', asks: [{ agentId: 'ag_1', app: 'mcp', url: 'https://observability.mcp.cloudflare.com/mcp', name: 'Cloudflare', auth: 'sign_in' }] }))
  assert.deepEqual(cloudflare?.elements.app0.props, { title: 'Cloudflare', brand: 'cloudflare', subtitle: 'observability.mcp.cloudflare.com', url: `${OPEN_PAGE}#/connections/new/mcp?for=ag_1&url=https%3A%2F%2Fobservability.mcp.cloudflare.com%2Fmcp&name=Cloudflare&auth=sign_in` })
  assert.equal(cardOf(askCard({ why: 'x', asks: [{ agentId: 'ag_1', app: 'mcp', url: 'https://evilcloudflare.com/mcp', name: 'Cloudflare' }] }))?.elements.app0.props.brand, 'mcp')
})

test('only an agent with its starter instructions is new', () => {
  assert.equal(isStarter({ name: 'Pulse', instructions: starterInstructions('Pulse') }), true)
  assert.equal(isStarter({ name: 'Pulse', instructions: '# Pulse\n\nKeep prod-db healthy.' }), false)
})
