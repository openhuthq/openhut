import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { WAITING, type TurnStatus } from '@openhut/common/threads/thread.ts'
import { db } from '../platform/db.ts'
import { emit, log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'

const SAVE_MS = 1000
const DEADLINE_MS = 2 * 60 * 60_000 + 60_000
const GRACE_MS = 15_000
const ABANDONED = 'Stopped: this reply stopped responding, so OpenHut ended it. Ask again.'

type Listener = (chunk?: UIMessageChunk) => void
type Turn = { id: string; thread: string; agentId: string; chunks: UIMessageChunk[]; saved: number; saving: Promise<void>; ended: boolean; running: boolean; abort: AbortController; listeners: Set<Listener> }
export type TurnRun = { signal: AbortSignal; write: (chunk: UIMessageChunk) => void }
export type TurnEnd = { message: UIMessage; failed: boolean }

export const statusChunk = (text: string): UIMessageChunk => ({ type: 'data-status', data: { text } satisfies TurnStatus, transient: true })

const active = new Map<string, Turn[]>()
const lanes = new Map<string, Promise<void>>()

export const turns = {
  start({ id, thread, agentId, run, save, deadlineMs = DEADLINE_MS, graceMs = GRACE_MS }: { id: string; thread: string; agentId: string; run: (turn: TurnRun) => Promise<void>; save: (end: TurnEnd) => Promise<void>; deadlineMs?: number; graceMs?: number }): Promise<void> {
    const turn: Turn = { id, thread, agentId, chunks: [], saved: 0, saving: Promise.resolve(), ended: false, running: false, abort: new AbortController(), listeners: new Set() }
    active.set(thread, [...active.get(thread) ?? [], turn])
    if (lanes.has(agentId)) send({ turn, chunk: statusChunk(WAITING) })
    changed(turn)
    const queued = db.insertInto('thread_turn').values({ id, thread_id: thread }).execute()
      .catch((err: unknown) => log.warn({ event: 'turn.queue_failed', thread, error: messageOf(err) }))
    const done = Promise.all([queued, lanes.get(agentId)]).then(() => go({ turn, run, save, deadlineMs, graceMs }))
    const lane = done.catch(() => undefined)
    lanes.set(agentId, lane)
    void lane.then(() => { if (lanes.get(agentId) === lane) lanes.delete(agentId) })
    return done
  },

  subscribe({ thread, id, signal }: { thread: string; id?: string; signal?: AbortSignal }): ReadableStream<UIMessageChunk> | null {
    const turn = id ? active.get(thread)?.find((each) => each.id === id) : active.get(thread)?.[0]
    if (!turn) return null
    let listener: Listener | undefined
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of turn.chunks) controller.enqueue(chunk)
        if (turn.ended) return controller.close()
        const each: Listener = (chunk) => {
          if (chunk) return controller.enqueue(chunk)
          turn.listeners.delete(each)
          controller.close()
        }
        listener = each
        turn.listeners.add(each)
        signal?.addEventListener('abort', () => turn.listeners.delete(each))
      },
      cancel() {
        if (listener) turn.listeners.delete(listener)
      },
    })
  },

  current: (thread: string): string | null => active.get(thread)?.[0]?.id ?? null,

  stop(thread: string): void {
    for (const turn of active.get(thread) ?? []) turn.abort.abort()
  },

  stopAgent(agentId: string): void {
    for (const turn of [...active.values()].flat()) if (turn.agentId === agentId && turn.running) turn.abort.abort()
  },

  async recover(save: (input: { thread: string; id: string; message: UIMessage }) => Promise<void>): Promise<void> {
    const rows = await db.selectFrom('thread_turn').select(['id', 'thread_id']).orderBy('id').execute()
    const running = new Set([...active.values()].flat().map((turn) => turn.id))
    for (const row of rows.filter((each) => !running.has(each.id))) {
      const chunks = await db.selectFrom('thread_chunk').select('chunk').where('turn_id', '=', row.id).orderBy('seq').execute()
      await save({ thread: row.thread_id, id: row.id, message: await fold({ id: row.id, chunks: chunks.map((each) => each.chunk as UIMessageChunk) }) })
        .catch((err: unknown) => log.warn({ event: 'turn.recover_failed', thread: row.thread_id, error: messageOf(err) }))
      await db.deleteFrom('thread_turn').where('id', '=', row.id).execute()
    }
  },
}

async function go({ turn, run, save, deadlineMs, graceMs }: { turn: Turn; run: (turn: TurnRun) => Promise<void>; save: (end: TurnEnd) => Promise<void>; deadlineMs: number; graceMs: number }): Promise<void> {
  const timer = setInterval(() => { turn.saving = turn.saving.then(() => persist(turn)) }, SAVE_MS).unref()
  turn.running = true
  const deadline = setTimeout(() => turn.abort.abort(), deadlineMs).unref()
  let failed = false
  let grace: NodeJS.Timeout | undefined
  const abandoned = new Promise<never>((_, reject) => turn.abort.signal.addEventListener('abort', () => {
    grace = setTimeout(() => reject(new Error(ABANDONED)), graceMs).unref()
  }, { once: true }))
  abandoned.catch(() => undefined)
  if (turn.chunks.length) send({ turn, chunk: statusChunk('') })
  try {
    await Promise.race([run({ signal: turn.abort.signal, write: (chunk) => { if (!turn.ended) send({ turn, chunk }) } }), abandoned])
  } catch (err) {
    failed = true
    send({ turn, chunk: { type: 'error', errorText: messageOf(err) } })
    throw err
  } finally {
    clearInterval(timer)
    clearTimeout(deadline)
    clearTimeout(grace)
    turn.running = false
    await end({ turn, save, failed })
  }
}

function send({ turn, chunk }: { turn: Turn; chunk: UIMessageChunk }): void {
  turn.chunks.push(chunk)
  for (const listener of turn.listeners) listener(chunk)
}

async function end({ turn, save, failed }: { turn: Turn; save: (end: TurnEnd) => Promise<void>; failed: boolean }): Promise<void> {
  await turn.saving
  try {
    if (turn.chunks.length) await save({ message: await fold({ id: turn.id, chunks: turn.chunks }), failed })
  } catch (err) {
    log.warn({ event: 'turn.save_failed', thread: turn.thread, error: messageOf(err) })
  }
  await db.deleteFrom('thread_turn').where('id', '=', turn.id).execute().catch((err: unknown) => log.warn({ event: 'turn.clear_failed', thread: turn.thread, error: messageOf(err) }))
  turn.ended = true
  const left = (active.get(turn.thread) ?? []).filter((each) => each !== turn)
  if (left.length) active.set(turn.thread, left)
  else active.delete(turn.thread)
  for (const listener of turn.listeners) listener()
  changed(turn)
}

async function persist(turn: Turn): Promise<void> {
  const from = turn.saved
  const chunks = turn.chunks.slice(from)
  if (!chunks.length) return
  turn.saved = turn.chunks.length
  await db.insertInto('thread_chunk').values(chunks.map((chunk, index) => ({ turn_id: turn.id, seq: from + index, chunk: JSON.stringify(chunk) }))).execute()
    .catch((err: unknown) => log.warn({ event: 'turn.persist_failed', thread: turn.thread, error: messageOf(err) }))
}

async function fold({ id, chunks }: { id: string; chunks: UIMessageChunk[] }): Promise<UIMessage> {
  let message: UIMessage = { id, role: 'assistant', parts: [] }
  const stream = ReadableStream.from(chunks.filter((chunk) => chunk.type !== 'error'))
  for await (const each of readUIMessageStream({ message, stream })) message = each
  return { ...message, id }
}

function changed(turn: Turn): void {
  emit({ name: 'thread.updated', target: { type: 'thread', id: turn.thread, agentId: turn.agentId } })
}
