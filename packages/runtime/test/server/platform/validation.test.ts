import { test } from 'node:test'
import assert from 'node:assert/strict'
import type * as z from 'zod/mini'
import { UpdateAgent } from '@openhut/common/agents/agent.ts'
import { UpdateChannel } from '@openhut/common/channels/channel.ts'
import { HttpError } from '../../../src/server/platform/http-error.ts'
import { validateWithZod } from '../../../src/server/platform/validation.ts'

const errorFor = ({ schema, body }: { schema: z.ZodMiniType; body: unknown }) => {
  const result = validateWithZod({ schema, httpPart: 'body', method: 'PATCH', url: '/' })(body)
  return typeof result === 'object' && 'error' in result ? result.error : undefined
}

test('a patch with no field the resource knows is refused', () => {
  for (const schema of [UpdateAgent, UpdateChannel]) {
    const error = errorFor({ schema, body: { foo: 1 } })
    assert.ok(error instanceof HttpError)
    assert.equal(error.status, 400)
    assert.equal(error.message, 'The request body is not valid. Send at least one field to change.')
  }
})

test('a bad field is a 400 that names it', () => {
  const error = errorFor({ schema: UpdateAgent, body: { model: 'gpt' } })
  assert.ok(error instanceof HttpError)
  assert.equal(error.param, 'model')
})
