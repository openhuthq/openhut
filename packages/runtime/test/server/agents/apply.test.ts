import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from '../../../src/server/platform/config.ts'
import { listen } from '../../../src/server/platform/events.ts'
import { HttpError } from '../../../src/server/platform/http-error.ts'
import { startDurable, stopDurable } from '../../../src/core/durable.ts'
import { apply } from '../../../src/server/agents/apply.ts'

config.durableInline = false
const events: string[] = []
listen((event) => { if (event.name.startsWith('agent.appl')) events.push(`${event.name} ${String((event.target as { id?: string } | undefined)?.id)}`) })
const runs: string[] = []
const failing = new Set<string>()
apply.use(async (agentId) => {
  await sleep(200)
  runs.push(agentId)
  if (failing.has(agentId)) throw new HttpError(502, 'agentd said no.')
})
await startDurable()
test.after(() => stopDurable())

const until = async (done: () => boolean) => {
  const end = Date.now() + 60_000
  while (!done() && Date.now() < end) await sleep(100)
  assert.ok(done(), 'timed out waiting')
}

test('a request answers at once and marks the agent applying; ten more while it runs collapse into at most one more apply', async () => {
  const started = Date.now()
  await apply.request('ag_burst')
  assert.ok(Date.now() - started < 100)
  assert.deepEqual(apply.state('ag_burst'), { applying: true, applyError: null })
  for (let i = 0; i < 10; i++) await apply.request('ag_burst')
  await until(() => !apply.state('ag_burst').applying)
  await sleep(1500)
  const count = runs.filter((id) => id === 'ag_burst').length
  assert.ok(count >= 1 && count <= 2, `applied ${count} times`)
  assert.ok(events.includes('agent.applied ag_burst'))
})

test('an apply that keeps failing ends with applyError and agent.apply_failed, and Retry clears it once it works', async () => {
  failing.add('ag_broken')
  await apply.request('ag_broken')
  await until(() => apply.state('ag_broken').applyError !== null)
  assert.deepEqual(apply.state('ag_broken'), { applying: false, applyError: 'agentd said no.' })
  assert.ok(events.includes('agent.apply_failed ag_broken'))
  failing.delete('ag_broken')
  await apply.request('ag_broken')
  assert.equal(apply.state('ag_broken').applyError, null)
  await until(() => !apply.state('ag_broken').applying)
  assert.equal(apply.state('ag_broken').applyError, null)
})

test('a turn waits for its agent\'s pending apply', async () => {
  await apply.request('ag_turnwait')
  await apply.settled('ag_turnwait')
  assert.equal(apply.state('ag_turnwait').applying, false)
  assert.ok(runs.includes('ag_turnwait'))
})
