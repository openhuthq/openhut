import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from '../../src/server/platform/config.ts'
import { durable, startDurable, stopDurable } from '../../src/core/durable.ts'

config.durableInline = false
const until = async (done: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms
  while (!done() && Date.now() < end) await sleep(100)
  assert.ok(done(), 'timed out waiting')
}

const latestRuns: string[] = []
let active = 0
let overlapped = false
const latest = durable<{ n: number }>('test-latest', 'latest', async ({ n }) => {
  active += 1
  overlapped ||= active > 1
  await sleep(300)
  latestRuns.push(String(n))
  active -= 1
})
const eachRuns: string[] = []
const each = durable<{ key: string; n: number }>('test-each', 'each', async ({ key, n }) => {
  await sleep(50)
  eachRuns.push(`${key}${n}`)
})
const tries: boolean[] = []
const flaky = durable<{ fail: number }>('test-flaky', 'latest', async ({ fail }, { last }) => {
  tries.push(last)
  if (tries.length <= fail) throw new Error('Not yet.')
})

await startDurable()
test.after(() => stopDurable())

test('latest: a burst for one key runs one at a time and collapses to the newest few, never all of them', async () => {
  for (let n = 1; n <= 10; n++) await latest.send('agent-a', { n })
  await sleep(4000)
  assert.ok(latestRuns.length >= 1 && latestRuns.length <= 2, `ran ${latestRuns.length} times`)
  assert.equal(overlapped, false)
})

test('each: every job runs, in order for its key', async () => {
  for (let n = 1; n <= 3; n++) await each.send('x', { key: 'x', n })
  await each.send('y', { key: 'y', n: 1 })
  await until(() => eachRuns.length === 4)
  assert.deepEqual(eachRuns.filter((run) => run.startsWith('x')), ['x1', 'x2', 'x3'])
})

test('a task that throws is run again, and knows when it is on its last try', async () => {
  await flaky.send('agent-f', { fail: 1 })
  await until(() => tries.length === 2)
  assert.deepEqual(tries, [false, false])
})
