import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'
import type * as z from 'zod/mini'
import { UpdateAgent } from '@openhut/common/agents/agent.ts'
import { UpdateChannel } from '@openhut/common/channels/channel.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'

// The type provider validates; answerErrors turns its error into our 400 shape.
const errorFor = async ({ schema, body }: { schema: z.ZodMiniType; body: unknown }) => {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  answerErrors(app)
  app.patch('/', { schema: { body: schema } }, async () => 'ok')
  const reply = await app.inject({ method: 'PATCH', url: '/', payload: body as object })
  return { status: reply.statusCode, ...reply.json<{ error: { message: string; param?: string } }>().error }
}

test('a patch with no field the resource knows is refused', async () => {
  for (const schema of [UpdateAgent, UpdateChannel]) {
    const error = await errorFor({ schema, body: { foo: 1 } })
    assert.equal(error.status, 400)
    assert.equal(error.message, 'The request body is not valid. Send at least one field to change.')
  }
})

test('a bad field is a 400 that names it', async () => {
  const error = await errorFor({ schema: UpdateAgent, body: { model: 'gpt' } })
  assert.equal(error.status, 400)
  assert.equal(error.param, 'model')
})
