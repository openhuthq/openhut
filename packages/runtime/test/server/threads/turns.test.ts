import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UIMessageChunk } from 'ai'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { turns, type TurnEnd, type TurnRun } from '../../../src/server/threads/turns.ts'

await migrate()

const text = (id: string, delta: string): UIMessageChunk[] => [{ type: 'text-start', id }, { type: 'text-delta', id, delta }, { type: 'text-end', id }]

function gate() {
  let open = () => undefined as void
  const opened = new Promise<void>((resolve) => { open = resolve })
  return { open, opened }
}

async function read(stream: ReadableStream<UIMessageChunk> | null): Promise<UIMessageChunk[]> {
  assert.ok(stream)
  const chunks: UIMessageChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

test('a late subscriber gets every chunk so far, then the rest live, and the stream closes when the turn ends; the end is folded, saved and cleared', async () => {
  const half = gate()
  const go = gate()
  const saved: TurnEnd[] = []
  const done = turns.start({
    id: 'msg_late', thread: 'th_late', agentId: 'ag_late',
    run: async ({ write }: TurnRun) => {
      write({ type: 'start', messageId: 'msg_late' })
      for (const chunk of text('t1', 'Hello ')) write(chunk)
      half.open()
      await go.opened
      for (const chunk of text('t2', 'there.')) write(chunk)
    },
    save: async (end) => { saved.push(end) },
  })
  assert.equal(turns.current('th_late'), 'msg_late')
  await half.opened
  const late = read(turns.subscribe({ thread: 'th_late' }))
  go.open()
  await done
  const heard = await late
  assert.deepEqual(heard.flatMap((chunk) => chunk.type === 'text-delta' ? [chunk.delta] : []), ['Hello ', 'there.'])
  assert.equal(saved.length, 1)
  assert.equal(saved[0].failed, false)
  assert.equal(saved[0].message.id, 'msg_late')
  assert.deepEqual(saved[0].message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []), ['Hello ', 'there.'])
  assert.equal(turns.current('th_late'), null)
  assert.equal(turns.subscribe({ thread: 'th_late' }), null)
  assert.equal((await db.selectFrom('thread_turn').select('id').where('id', '=', 'msg_late').execute()).length, 0)
})

test('stop aborts the running turn, and what it said so far is still saved', async () => {
  const started = gate()
  const saved: TurnEnd[] = []
  const done = turns.start({
    id: 'msg_stop', thread: 'th_stop', agentId: 'ag_stop',
    run: async ({ write, signal }) => {
      for (const chunk of text('t1', 'Half')) write(chunk)
      started.open()
      await new Promise((resolve) => signal.addEventListener('abort', resolve))
    },
    save: async (end) => { saved.push(end) },
  })
  await started.opened
  turns.stop('th_stop')
  await done
  assert.deepEqual(saved[0].message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []), ['Half'])
})

test('a second turn for the same agent waits for the first, but already counts as the thread\'s working turn', async () => {
  const first = gate()
  const order: string[] = []
  const one = turns.start({ id: 'msg_q1', thread: 'th_q1', agentId: 'ag_q', run: async () => { order.push('one'); await first.opened; order.push('one done') }, save: async () => undefined })
  const two = turns.start({ id: 'msg_q2', thread: 'th_q2', agentId: 'ag_q', run: async () => { order.push('two') }, save: async () => undefined })
  assert.equal(turns.current('th_q2'), 'msg_q2')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(order, ['one'])
  first.open()
  await Promise.all([one, two])
  assert.deepEqual(order, ['one', 'one done', 'two'])
})

test('a failed turn ends its stream with the error and is saved as failed', async () => {
  const saved: TurnEnd[] = []
  const done = turns.start({ id: 'msg_fail', thread: 'th_fail', agentId: 'ag_fail', run: async ({ write }) => { for (const chunk of text('t1', 'Hm')) write(chunk); throw new Error('The model failed.') }, save: async (end) => { saved.push(end) } })
  const heard = read(turns.subscribe({ thread: 'th_fail' }))
  await assert.rejects(done, /The model failed/)
  assert.deepEqual((await heard).at(-1), { type: 'error', errorText: 'The model failed.' })
  assert.equal(saved[0].failed, true)
})

test('after a restart, a turn that was cut off is folded from its saved chunks', async () => {
  await db.insertInto('thread_turn').values({ id: 'msg_crash', thread_id: 'th_crash' }).execute()
  await db.insertInto('thread_chunk').values(text('t1', 'Before the crash').map((chunk, seq) => ({ turn_id: 'msg_crash', seq, chunk: JSON.stringify(chunk) }))).execute()
  const found: { thread: string; id: string; text: string[] }[] = []
  await turns.recover(async ({ thread, id, message }) => { found.push({ thread, id, text: message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []) }) })
  assert.deepEqual(found, [{ thread: 'th_crash', id: 'msg_crash', text: ['Before the crash'] }])
  assert.equal((await db.selectFrom('thread_chunk').select('seq').where('turn_id', '=', 'msg_crash').execute()).length, 0)
})
