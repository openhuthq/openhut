import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: dev sign-in, save the kit, make an agent, chat with it, add a connection, all kept as sealed records', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { config } = await import('../../../src/server/platform/config.ts')
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { agentController } = await import('../../../src/server/agents/agent-controller.ts')
  const { threadController } = await import('../../../src/server/threads/thread-controller.ts')
  const { connectionController } = await import('../../../src/server/connections/connection-controller.ts')
  const { recordsService } = await import('../../../src/server/cloud/records.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  await migrate()
  const hermes = createServer((req, res) => {
    req.resume().on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Four.' } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>((resolve) => hermes.listen(0, '127.0.0.1', resolve))
  config.agentApi = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`

  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  await app.register(agentController, { prefix: '/api/agents' })
  await app.register(threadController, { prefix: '/api/threads' })
  await app.register(connectionController, { prefix: '/api/connections' })
  const headers = { authorization: 'Bearer test-key' }
  const status = async () => (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string; email: string | null; kit: unknown; workspace: { id: string } | null }>()
  try {
    assert.equal((await status()).status, 'off')
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    const callback = await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' })
    assert.match((await app.inject({ method: 'GET', url: callback })).body, /You’re signed in/)
    for (let i = 0; i < 100 && (await status()).status !== 'on'; i++) await sleep(50)
    const on = await status()
    assert.equal(on.status, 'on')
    assert.equal(on.email, 'mo@example.com')
    assert.equal(on.kit, null)

    const kit = await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })
    assert.equal(kit.statusCode, 200, kit.body)
    assert.equal(kit.json<{ words: string[] }>().words.length, 12)
    assert.ok((await status()).kit)

    const made = await app.inject({ method: 'POST', url: '/api/agents', headers, payload: { name: 'Juniper', instructions: 'Answer briefly.' } })
    assert.equal(made.statusCode, 200, made.body)
    const agent = made.json<{ id: string }>()
    const workspace = on.workspace?.id ?? ''
    assert.equal((await recordsService.get({ collection: 'control', workspace, id: agent.id }))?.parent, agent.id)

    assert.equal((await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, headers, payload: { wanted: 'running' } })).statusCode, 200)
    const { db } = await import('../../../src/server/platform/db.ts')
    const running = async () => (await db.selectFrom('agent').select('wanted').where('id', '=', agent.id).executeTakeFirst())?.wanted === 'running'
    for (let i = 0; i < 100 && !await running(); i++) await sleep(50)
    const said = await app.inject({ method: 'POST', url: `/api/threads/${agent.id}/chat`, headers, payload: { trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'What’s 2+2?' }] } } })
    assert.equal(said.statusCode, 200, said.body)
    assert.match(said.body, /Four\./)
    await recordsService.drain()
    const messages = await recordsService.list({ collection: 'message', workspace, parent: agent.id })
    assert.equal(messages.length, 2)

    const connected = await app.inject({ method: 'POST', url: '/api/connections', headers, payload: { kind: 'excalidraw', name: 'Excalidraw' } })
    assert.equal(connected.statusCode, 200, connected.body)
    const connection = connected.json<{ id: string }>()
    const listed = (await app.inject({ method: 'GET', url: '/api/connections', headers })).json<{ data: { id: string }[] }>().data
    assert.deepEqual(listed.map((each) => each.id), [connection.id])
    const record = await recordsService.get({ collection: 'connection', workspace, id: connection.id })
    assert.equal(record?.personal, true)
    assert.ok(keysService.vault(), 'a Mac holds the account’s vault key for connection secrets')
  } finally {
    cloudEvents.stop()
    hermes.close()
    await app.close()
    await cloud.close()
  }
})
