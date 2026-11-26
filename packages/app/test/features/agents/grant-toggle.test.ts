import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import type { Grant } from '@openhut/common/agents/agent.ts'
import { grantId, grantToggle } from '../../../src/features/agents/grant-toggle.ts'
import { grantsKey } from '../../../src/lib/query-keys.ts'

const pair = { agentId: 'ag_1', connectionId: 'cn_1' }
const byConnection = grantsKey({ connectionId: 'cn_1' })
const byAgent = grantsKey({ agentId: 'ag_1' })
const ids = (client: QueryClient, key: ReturnType<typeof grantsKey>) => client.getQueryData<Grant[]>(key)?.map((grant) => grant.id)

function setUp() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  client.setQueryData<Grant[]>(byConnection, [])
  client.setQueryData<Grant[]>(byAgent, [])
  let settle: (ok: boolean) => void = () => undefined
  const mutationFn = () => new Promise<void>((resolve, reject) => { settle = (ok) => ok ? resolve() : reject(new Error('That agent doesn\'t exist.')) })
  return { client, mutationFn, settle: (ok: boolean) => settle(ok) }
}

test('ticking an agent shows it at once, before the server answers', async () => {
  const { client, mutationFn, settle } = setUp()
  const done = new MutationObserver(client, grantToggle({ client, on: true, mutationFn })).mutate(pair)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(ids(client, byConnection), [grantId(pair)])
  assert.deepEqual(ids(client, byAgent), [grantId(pair)])
  settle(true)
  await done
  assert.deepEqual(ids(client, byConnection), [grantId(pair)])
})

test('a failed save puts the tick back where it was', async () => {
  const { client, mutationFn, settle } = setUp()
  const done = new MutationObserver(client, grantToggle({ client, on: true, mutationFn })).mutate(pair).catch((error: Error) => error)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(ids(client, byConnection), [grantId(pair)])
  settle(false)
  assert.ok(await done instanceof Error)
  assert.deepEqual(ids(client, byConnection), [])
  assert.deepEqual(ids(client, byAgent), [])
})

test('unticking removes it at once and a failure brings it back', async () => {
  const { client, mutationFn, settle } = setUp()
  const grant: Grant = { id: grantId(pair), object: 'grant', ...pair, createdAt: '2026-11-26T00:00:00.000Z' }
  client.setQueryData<Grant[]>(byConnection, [grant])
  const done = new MutationObserver(client, grantToggle({ client, on: false, mutationFn })).mutate(grant).catch((error: Error) => error)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(ids(client, byConnection), [])
  settle(false)
  await done
  assert.deepEqual(client.getQueryData(byConnection), [grant])
})
