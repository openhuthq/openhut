import { PgBoss, fromPglite } from 'pg-boss'
import { pglite } from '../server/platform/db.ts'
import { config } from '../server/platform/config.ts'
import { log } from '../server/platform/events.ts'
import { messageOf } from '../server/platform/http-error.ts'

type Mode = 'latest' | 'each'
type Run<T> = (data: T, job: { last: boolean }) => Promise<void>
type Task = { name: string; mode: Mode; run: Run<never> }

const RETRIES = 5
const tasks: Task[] = []
let boss: PgBoss | undefined

export function durable<T extends object>(name: string, mode: Mode, run: Run<T>): { send: (key: string, data: T) => Promise<void> } {
  tasks.push({ name, mode, run: run as Run<never> })
  return {
    async send(key, data) {
      if (config.durableInline) return run(data, { last: true })
      if (!boss) throw new Error(`Durable tasks aren't started yet, so ${name} can't run.`)
      await boss.send(name, data, mode === 'latest' ? { singletonKey: key } : { group: { id: key } })
    },
  }
}

export async function startDurable(): Promise<void> {
  boss = new PgBoss({ db: fromPglite(pglite), backend: 'pglite', schedule: false, superviseIntervalSeconds: 5 })
  boss.on('error', (err: unknown) => log.warn({ event: 'durable.error', error: messageOf(err) }))
  await boss.start()
  for (const task of tasks) {
    await boss.createQueue(task.name, { policy: task.mode === 'latest' ? 'stately' : 'standard', retryLimit: RETRIES, retryDelay: 2, heartbeatSeconds: 15 })
    await boss.work(task.name, { localConcurrency: 4, includeMetadata: true, pollingIntervalSeconds: 0.5, groupConcurrency: task.mode === 'each' ? 1 : undefined }, async ([job]) => {
      await task.run(job.data as never, { last: job.retryCount >= job.retryLimit })
    })
  }
}

export async function stopDurable(): Promise<void> {
  await boss?.stop({ graceful: false })
  boss = undefined
}
