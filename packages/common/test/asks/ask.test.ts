import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileSpecStream } from '@json-render/core'
import { askCard, askedPath, askPath, OPEN_PAGE } from '../../src/asks/ask.ts'
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

test('askCard is a valid card whose button opens the sheet', () => {
  const block = askCard({ agentId: 'ag_1', app: 'postgres', why: 'To watch postgres-eu.' })
  const card = parseCard(compileSpecStream(SPEC_BLOCK.exec(block)?.[1] ?? ''))
  assert.ok(card)
  assert.equal(card.elements.go.props.url, `${OPEN_PAGE}#/connections/new/postgres?for=ag_1`)
  assert.deepEqual(card.elements.ask.props, { title: 'Postgres', brand: 'postgres' })
  const cloudflare = parseCard(compileSpecStream(SPEC_BLOCK.exec(askCard({ agentId: 'ag_1', app: 'mcp', url: 'https://observability.mcp.cloudflare.com/mcp', name: 'Cloudflare', auth: 'sign_in', why: 'Logs.' }))?.[1] ?? ''))
  assert.deepEqual(cloudflare?.elements.ask.props, { title: 'Cloudflare', brand: 'cloudflare', subtitle: 'observability.mcp.cloudflare.com' })
  const lookalike = parseCard(compileSpecStream(SPEC_BLOCK.exec(askCard({ agentId: 'ag_1', app: 'mcp', url: 'https://evilcloudflare.com/mcp', name: 'Cloudflare', why: 'x' }))?.[1] ?? ''))
  assert.equal(lookalike?.elements.ask.props.brand, 'mcp')
})
