import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { connectionAuthorizationService } from '../../../src/server/connections/connection-authorization-service.ts'
import { connectionService } from '../../../src/server/connections/connection-service.ts'
import { mcp } from '../../../src/server/integrations/mcp/mcp.ts'

const lan = Object.values(networkInterfaces()).flat().find((each) => each?.family === 'IPv4' && !each.internal)?.address
const actor = { id: 'usr_aaaaaaaa', email: 'owner@example.com', role: 'owner' as const }
await migrate()
await db.insertInto('person').values({ id: actor.id, email: actor.email, role: 'owner' }).execute()

test('a sign-in registers OpenHut, finishes once, and its token reaches the tools', { skip: !lan && 'needs a non-loopback address' }, async () => {
  const server = await oauthMcpServer(lan ?? '')
  try {
    const url = `${server.base}/mcp`
    const begin = new URL((await connectionAuthorizationService.create({ actor, kind: 'mcp', name: 'Local', url })).authorizationUrl)
    assert.equal(begin.searchParams.get('client_id'), 'client-1')
    assert.equal(begin.searchParams.get('code_challenge_method'), 'S256')
    assert.match((await connectionAuthorizationService.finish({ state: begin.searchParams.get('state') ?? '', code: 'wrong' })).error ?? '', /refused the sign-in/)

    const state = new URL((await connectionAuthorizationService.create({ actor, kind: 'mcp', name: 'Local', url })).authorizationUrl).searchParams.get('state') ?? ''
    const stored = await db.selectFrom('sign_in').selectAll().where('state', '=', state).executeTakeFirstOrThrow()
    assert.equal(stored.status, 'pending')
    assert.doesNotMatch(stored.data, /client-1|codeVerifier/, 'what the sign-in needs later is sealed')
    assert.equal((await connectionAuthorizationService.get({ actor, id: state })).status, 'pending')
    const done = await connectionAuthorizationService.finish({ state, code: 'good' })
    if (!done.connectionId) assert.fail(done.error ?? 'no connection')
    assert.match((await connectionAuthorizationService.finish({ state, code: 'good' })).error ?? '', /expired or was already used/)
    assert.deepEqual(await db.selectFrom('sign_in').select(['status', 'data']).where('state', '=', state).executeTakeFirstOrThrow(), { status: 'done', data: '' })
    assert.equal((await connectionAuthorizationService.get({ actor, id: state })).connectionId, done.connectionId)
    const connection = await connectionService.get({ actor, id: done.connectionId })
    assert.equal(connection.signIn, true)
    assert.deepEqual((await connectionService.listTools({ actor, connectionId: connection.id })).map((tool) => tool.name), ['mcp_ping'])
    const row = await db.selectFrom('connection').select('config').where('id', '=', connection.id).executeTakeFirstOrThrow()
    assert.ok(!row.config.includes('at-'), 'tokens are sealed')
  } finally {
    server.close()
  }
})

test('a sign-in lives in the database: only its owner can read it, an expired one reads as failed, and old ones are swept', async () => {
  const row = { actor: JSON.stringify(actor), actor_id: actor.id, kind: 'linear', name: 'Linear', existing_id: null, data: '', status: 'pending' as const }
  await db.insertInto('sign_in').values([
    { ...row, state: 'st_late', expires_at: new Date(Date.now() - 60_000) },
    { ...row, state: 'st_ancient', expires_at: new Date(Date.now() - 60 * 60_000) },
  ]).execute()
  assert.deepEqual(await connectionAuthorizationService.get({ actor, id: 'st_late' }), { object: 'connection_authorization', id: 'st_late', kind: 'linear', authorizationUrl: '', status: 'failed', error: 'This sign-in expired. Start it again.' })
  await assert.rejects(connectionAuthorizationService.get({ actor: { ...actor, id: 'usr_someone' }, id: 'st_late' }), { status: 404 })
  assert.match((await connectionAuthorizationService.finish({ state: 'st_late', code: 'x' })).error ?? '', /expired or was already used/)
  await connectionAuthorizationService.sweep()
  assert.deepEqual((await db.selectFrom('sign_in').select('state').where('state', 'like', 'st_%').execute()).map((each) => each.state), ['st_late'])
})

test('a custom MCP header must be one plain Name: value, never a transport header', () => {
  assert.deepEqual(mcp.parseHeader('Authorization: Bearer abc'), { Authorization: 'Bearer abc' })
  assert.equal(mcp.parseHeader('  '), undefined)
  for (const header of ['Host: evil.example', 'Bearer abc', 'Content-Type: text/plain', 'X-Key:']) assert.throws(() => mcp.parseHeader(header), { param: 'header' })
})

async function oauthMcpServer(host: string): Promise<{ base: string; close: () => void; expire: () => void; refreshes: () => number }> {
  let base = ''
  let valid = 'at-1'
  let refreshes = 0
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    const json = (status: number, value: unknown, headers = {}) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(value))
    const path = new URL(req.url ?? '/', base).pathname
    if (path === '/.well-known/oauth-protected-resource/mcp') return json(200, { resource: `${base}/mcp`, authorization_servers: [base] })
    if (path === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
        response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (path === '/register') return json(201, { ...JSON.parse(body), client_id: 'client-1' })
    if (path === '/token') {
      const form = new URLSearchParams(body)
      if (form.get('code') === 'good' && form.get('code_verifier')) return json(200, { access_token: 'at-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-1' })
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'rt-1') {
        refreshes++
        return json(200, { access_token: 'at-2', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-2' })
      }
      return json(400, { error: 'invalid_grant' })
    }
    if (path !== '/mcp') return json(404, { error: 'not found' })
    if (req.headers.authorization !== `Bearer ${valid}`) return json(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` })
    const tools = new McpServer({ name: 'local', version: '1' })
    tools.registerTool('ping', { description: 'Answers pong.' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await tools.connect(transport)
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined)
  }).listen(0, '0.0.0.0')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  base = `http://${host}:${typeof address === 'object' && address ? address.port : 0}`
  return { base, close: () => server.close(), expire: () => { valid = 'at-2' }, refreshes: () => refreshes }
}
