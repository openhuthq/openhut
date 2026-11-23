import type { Selectable } from 'kysely'
import { Cron } from 'croner'
import * as z from 'zod/mini'
import type { Deleted } from '@openhut/common/api.ts'
import { ROUTINE_NAME_MAX, ROUTINE_PLAN_MAX, type Routine } from '@openhut/common/routines/routine.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { deleted } from '../platform/responses.ts'
import { newId } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { agentService } from '../agents/agent-service.ts'
import type { Caller } from '../team/identity.ts'

const TICK_MS = 60_000
const PICKUP_MS = 5 * 60_000
const REPORT_MS = 30 * 60_000
const MIN_GAP_MS = 15 * 60_000
const MAX_DAYS = 90
const DAY_MS = 86_400_000
const MAX_ACTIVE = 20
const MAX_RUNS_A_DAY = 100
const MAX_FAILURES = 3
const CRON_SAMPLE = 100
const SILENT = /^\s*\[?(SILENT|NO[_ ]REPLY)\]?\s*$/i
const OFFSET = /(Z|[+-]\d\d:?\d\d)$/i
const DASHBOARD = 'api_server'
const THREAD_SESSION = /^openhut-(th_[a-z0-9]+)$/
const PLATFORM_NAMES: Record<string, string> = { slack: 'Slack', whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord' }

export const Origin = z.looseObject({
  platform: z.string().check(z.minLength(1), z.maxLength(40)),
  chat_id: z.string().check(z.minLength(1), z.maxLength(200)),
  chat_type: z.optional(z.nullable(z.string())),
  chat_name: z.optional(z.nullable(z.string())),
  thread_id: z.optional(z.nullable(z.string())),
  user_id: z.optional(z.nullable(z.string())),
  user_name: z.optional(z.nullable(z.string())),
})
export type Origin = z.infer<typeof Origin>
type Stored = Origin & { place: string }
type RoutineRow = Selectable<Database['routine']>
type ScheduleInput = { name: string; plan: string; at?: string; cron?: string; until?: string; origin?: unknown }
export type DueRun = { runId: string; routineId: string; text: string; origin: Origin }

const ranToday = new Map<string, { day: string; count: number; capLogged: boolean }>()
const dashboardRuns = new Set<string>()
let ticking: NodeJS.Timeout | undefined
let inTick = false
let dashboardRunner: (input: { agentId: string; threadId: string; text: string }) => Promise<string> = async () => { throw new Error('No dashboard runner.') }

export const routineService = {
  async schedule({ agentId, input }: { agentId: string; input: ScheduleInput }): Promise<string> {
    const name = input.name.trim().slice(0, ROUTINE_NAME_MAX)
    const plan = input.plan.trim().slice(0, ROUTINE_PLAN_MAX)
    if (!name || !plan) throw new HttpError(400, 'Give the routine a name and a plan.')
    if (!!input.at === !!input.cron) throw new HttpError(400, 'Send either at (one time) or cron (repeating), not both.')
    const origin = z.safeParse(Origin, input.origin)
    if (!origin.success) throw new HttpError(400, 'You can only set up routines from a chat you\'re in.')
    const place = await placeOf({ agentId, origin: origin.data })
    if (await openRun(agentId)) throw new HttpError(409, 'A routine can\'t set up another routine. Tell the person instead.')
    const active = await db.selectFrom('routine').select((eb) => eb.fn.countAll<number>().as('n')).where('agent_id', '=', agentId).executeTakeFirstOrThrow()
    if (Number(active.n) >= MAX_ACTIVE) throw new HttpError(409, `You already have ${MAX_ACTIVE} routines. Stop one with cancel_routine first.`)
    const now = new Date()
    const at = input.at ? timeOf({ value: input.at, field: 'at' }) : null
    if (at && at.getTime() < now.getTime() - 60_000) throw new HttpError(400, 'That time has passed. Pick a time in the future.')
    const until = input.cron ? untilOf({ value: input.until, now }) : null
    const nextRunAt = at ?? nextOf({ cron: checkedCron(input.cron ?? ''), after: now })
    const row = await db.insertInto('routine').values({
      id: newId('rt'), agent_id: agentId, name, plan, at, cron: input.cron ?? null, until, origin: JSON.stringify({ ...origin.data, place }), next_run_at: nextRunAt,
    }).returningAll().executeTakeFirstOrThrow()
    changed({ name: 'routine.scheduled', agentId, routineId: row.id, properties: { cron: row.cron, at: at?.toISOString() } })
    return `Scheduled ${row.id}, next ${nextRunAt ? shortTime(nextRunAt) : 'never'}. Reports go to ${place}.`
  },

  async listForAgent({ agentId }: { agentId: string }): Promise<string> {
    const rows = await db.selectFrom('routine').selectAll().where('agent_id', '=', agentId).orderBy('created_at').execute()
    if (!rows.length) return 'No routines.'
    return rows.map((row) => `${row.id} ${row.name} · ${row.cron ?? 'once'} · ${row.next_run_at ? `next ${shortTime(new Date(row.next_run_at))}` : stoppedOf(row) ?? 'running now'}`).join('\n')
  },

  async cancel({ agentId, id, reason }: { agentId: string; id: string; reason: string }): Promise<string> {
    const gone = await db.deleteFrom('routine').where('id', '=', id).where('agent_id', '=', agentId).executeTakeFirst()
    if (!gone.numDeletedRows) throw new HttpError(404, `No routine ${id}. Call list_routines to see yours.`)
    changed({ name: 'routine.ended', agentId, routineId: id, properties: { reason: reason.slice(0, 200) || 'cancelled' } })
    return 'Stopped.'
  },

  async due({ agentId }: { agentId: string }): Promise<DueRun[]> {
    const rows = await db.selectFrom('routine').selectAll().where('agent_id', '=', agentId).where('run_status', '=', 'open').where('run_picked_at', 'is', null).execute()
    return rows.flatMap((row) => {
      const origin = originOf(row)
      return row.run_id && origin.platform !== DASHBOARD ? [{ runId: row.run_id, routineId: row.id, text: runText(row), origin: hermesOrigin(origin) }] : []
    })
  },

  async picked({ agentId, runId }: { agentId: string; runId: string }): Promise<void> {
    const done = await db.updateTable('routine').set({ run_picked_at: new Date() }).where('agent_id', '=', agentId).where('run_id', '=', runId).where('run_status', '=', 'open').returning('id').executeTakeFirst()
    if (!done) throw new HttpError(404, `No open run ${runId}.`)
    changed({ name: 'routine.run', agentId, routineId: done.id, properties: { run: runId, status: 'picked' } })
  },

  async report({ agentId, runId, said }: { agentId: string; runId: string; said: string }): Promise<void> {
    const row = await db.selectFrom('routine').selectAll().where('agent_id', '=', agentId).where('run_id', '=', runId).where('run_status', '=', 'open').where('run_picked_at', 'is not', null).executeTakeFirst()
    if (!row) throw new HttpError(404, `No open run ${runId}.`)
    const status = SILENT.test(said) ? 'quiet' : 'told'
    changed({ name: 'routine.run', agentId, routineId: row.id, properties: { run: runId, status } })
    if (!row.cron) {
      await db.deleteFrom('routine').where('id', '=', row.id).execute()
      changed({ name: 'routine.ended', agentId, routineId: row.id, properties: { reason: 'ran once' } })
      return
    }
    await db.updateTable('routine').set({ run_status: status, run_text: status === 'told' ? said.slice(0, 2000) : null, failures: 0 }).where('id', '=', row.id).execute()
  },

  async list({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Routine[]> {
    await agentService.requireEditable({ actor, id: agentId })
    const rows = await db.selectFrom('routine').selectAll().where('agent_id', '=', agentId).orderBy('next_run_at', (ob) => ob.asc().nullsLast()).execute()
    return rows.map(routineOf)
  },

  async stop({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'routine'>> {
    const row = await db.selectFrom('routine').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) throw new HttpError(404, `There's no routine ${id}.`)
    await agentService.requireEditable({ actor, id: row.agent_id })
    await db.deleteFrom('routine').where('id', '=', id).execute()
    changed({ name: 'routine.ended', agentId: row.agent_id, routineId: id, properties: { reason: 'stopped by the owner' } })
    return deleted({ id, object: 'routine' })
  },

  async exportFor({ agentId }: { agentId: string }): Promise<Moved[]> {
    const rows = await db.selectFrom('routine').selectAll().where('agent_id', '=', agentId).execute()
    return rows.map((row) => ({ name: row.name, plan: row.plan, at: row.at && new Date(row.at).toISOString(), cron: row.cron, until: row.until && new Date(row.until).toISOString(), origin: row.origin }))
  },

  async importFor({ agentId, routines, threads }: { agentId: string; routines: Moved[]; threads: Map<string, string> }): Promise<void> {
    const now = new Date()
    for (const each of routines) {
      const origin = z.safeParse(Origin, JSON.parse(each.origin)).data
      if (!origin) continue
      const thread = THREAD_SESSION.exec(origin.chat_id)?.[1]
      const moved = origin.platform === DASHBOARD && thread ? { ...origin, chat_id: `openhut-${threads.get(thread) ?? thread}` } : origin
      const nextRunAt = each.cron ? nextOf({ cron: each.cron, after: now }) : each.at && new Date(each.at) > now ? new Date(each.at) : now
      await db.insertInto('routine').values({ id: newId('rt'), agent_id: agentId, name: each.name, plan: each.plan, at: each.at, cron: each.cron, until: each.until, origin: JSON.stringify(moved), next_run_at: nextRunAt }).execute()
    }
  },

  async retime(): Promise<void> {
    const now = new Date()
    const rows = await db.selectFrom('routine').select(['id', 'cron']).where('cron', 'is not', null).where('next_run_at', 'is not', null).execute()
    for (const row of rows) await db.updateTable('routine').set({ next_run_at: nextOf({ cron: row.cron ?? '', after: now }) }).where('id', '=', row.id).execute()
  },

  setTimeZone: async (zone: string): Promise<void> => {
    if (zone === settings.timeZone() || !validZone(zone)) return
    await settings.setTimeZone(zone)
    await routineService.retime()
  },

  runDashboardWith(runner: typeof dashboardRunner): void {
    dashboardRunner = runner
  },

  start(): void {
    if (ticking) return
    const run = () => void routineService.tick().catch((err: unknown) => log.error({ event: 'routine.tick_failed', error: messageOf(err) }))
    ticking = setInterval(run, TICK_MS)
    ticking.unref()
    run()
  },

  async tick({ now = new Date() }: { now?: Date } = {}): Promise<void> {
    if (inTick) return
    inTick = true
    try {
      await tickOnce(now)
    } finally {
      inTick = false
    }
  },
}

async function tickOnce(now: Date): Promise<void> {
  const expired = await db.deleteFrom('routine').where('until', '<=', now).returning(['id', 'agent_id']).execute()
  for (const row of expired) changed({ name: 'routine.ended', agentId: row.agent_id, routineId: row.id, properties: { reason: 'until passed' } })
  await sweep(now)
  const due = await db.selectFrom('routine').selectAll().where('next_run_at', '<=', now).where((eb) => eb.or([eb('run_status', 'is', null), eb('run_status', '<>', 'open')])).orderBy('next_run_at').execute()
  for (const row of due) await fire({ row, now })
}

export type Moved = { name: string; plan: string; at: string | null; cron: string | null; until: string | null; origin: string }

async function fire({ row, now }: { row: RoutineRow; now: Date }): Promise<void> {
  const agent = await db.selectFrom('agent').select(['id', 'wanted']).where('id', '=', row.agent_id).executeTakeFirst()
  if (agent?.wanted !== 'running') return
  if (!underCap({ agentId: row.agent_id, now })) return
  const runId = newId('ru')
  const origin = originOf(row)
  const refused = await placeOf({ agentId: row.agent_id, origin }).then(() => null, (err: unknown) => messageOf(err))
  const claimed = await db.updateTable('routine').set((eb) => ({
    run_id: runId, run_status: refused ? 'failed' : 'open', run_at: now, run_picked_at: null, run_text: refused, next_run_at: row.cron ? nextOf({ cron: row.cron, after: now }) : null,
    failures: refused ? eb('failures', '+', 1) : eb.ref('failures'),
  })).where('id', '=', row.id).where('next_run_at', '<=', now).where((eb) => eb.or([eb('run_status', 'is', null), eb('run_status', '<>', 'open')])).returningAll().executeTakeFirst()
  if (!claimed) return
  changed({ name: 'routine.run', agentId: row.agent_id, routineId: row.id, properties: { run: runId, status: refused ? 'failed' : 'open', reason: refused ?? undefined } })
  if (refused) {
    if (!claimed.cron || claimed.failures >= MAX_FAILURES) await db.updateTable('routine').set({ next_run_at: null }).where('id', '=', row.id).execute()
    return
  }
  if (origin.platform === DASHBOARD) void runOnDashboard({ row: claimed, origin })
}

async function runOnDashboard({ row, origin }: { row: RoutineRow; origin: Stored }): Promise<void> {
  const runId = row.run_id ?? ''
  const threadId = THREAD_SESSION.exec(origin.chat_id)?.[1] ?? ''
  if (dashboardRuns.has(threadId)) return
  dashboardRuns.add(threadId)
  try {
    await routineService.picked({ agentId: row.agent_id, runId })
    const said = await dashboardRunner({ agentId: row.agent_id, threadId, text: runText(row) })
    await routineService.report({ agentId: row.agent_id, runId, said })
  } catch (err) {
    await fail({ routineId: row.id, runId, text: 'No answer in time.' })
    log.warn({ event: 'routine.run', agent: row.agent_id, routine: row.id, run: runId, status: 'failed', error: messageOf(err) })
  } finally {
    dashboardRuns.delete(threadId)
  }
}

async function sweep(now: Date): Promise<void> {
  const stale = await db.selectFrom('routine').select(['id', 'run_id', 'run_picked_at']).where('run_status', '=', 'open').where((eb) => eb.or([
    eb.and([eb('run_picked_at', 'is', null), eb('run_at', '<', new Date(now.getTime() - PICKUP_MS))]),
    eb('run_picked_at', '<', new Date(now.getTime() - REPORT_MS)),
  ])).execute()
  for (const row of stale) await fail({ routineId: row.id, runId: row.run_id ?? '', text: row.run_picked_at ? 'No answer in time.' : 'Not picked up.' })
}

async function fail({ routineId, runId, text }: { routineId: string; runId: string; text: string }): Promise<void> {
  const row = await db.updateTable('routine').set((eb) => ({ run_status: 'failed', run_text: text, failures: eb('failures', '+', 1) })).where('id', '=', routineId).where('run_id', '=', runId).returningAll().executeTakeFirst()
  if (!row) return
  changed({ name: 'routine.run', agentId: row.agent_id, routineId: row.id, properties: { run: runId, status: 'failed', reason: text } })
  if (!row.cron || row.failures >= MAX_FAILURES) await db.updateTable('routine').set({ next_run_at: null }).where('id', '=', row.id).execute()
}

function underCap({ agentId, now }: { agentId: string; now: Date }): boolean {
  const day = now.toISOString().slice(0, 10)
  const today = ranToday.get(agentId)
  const count = today?.day === day ? today : { day, count: 0, capLogged: false }
  if (count.count >= MAX_RUNS_A_DAY) {
    if (!count.capLogged) log.warn({ event: 'routine.run', agent: agentId, status: 'capped', limit: MAX_RUNS_A_DAY })
    ranToday.set(agentId, { ...count, capLogged: true })
    return false
  }
  ranToday.set(agentId, { ...count, count: count.count + 1 })
  return true
}

async function openRun(agentId: string): Promise<boolean> {
  const row = await db.selectFrom('routine').select('id').where('agent_id', '=', agentId).where('run_status', '=', 'open').where('run_picked_at', 'is not', null).executeTakeFirst()
  return !!row
}

async function placeOf({ agentId, origin }: { agentId: string; origin: Origin }): Promise<string> {
  if (origin.platform === DASHBOARD) {
    const thread = THREAD_SESSION.exec(origin.chat_id)?.[1]
    const row = thread && await db.selectFrom('thread').select('id').where('id', '=', thread).where('agent_id', '=', agentId).executeTakeFirst()
    if (!row) throw new HttpError(400, 'You can only set up routines from a chat you\'re in.')
    return 'the OpenHut app'
  }
  const channel = await db.selectFrom('channel').selectAll().where('agent_id', '=', agentId).where('kind', '=', origin.platform as 'slack').where('status', '=', 'connected').executeTakeFirst()
  if (!channel) throw new HttpError(400, `Can't post in ${PLATFORM_NAMES[origin.platform] ?? origin.platform} any more.`)
  const allowed = channel.allowed.split(',').filter(Boolean)
  if (channel.kind === 'slack') {
    const dm = origin.chat_type === 'dm' && origin.chat_id.startsWith('D')
    if (!dm && !allowed.includes(origin.chat_id)) throw new HttpError(400, `Can't post in ${origin.chat_name ? `#${origin.chat_name.replace(/^#/, '')}` : 'that channel'} any more.`)
    return dm ? 'your Slack DM' : `#${(origin.chat_name ?? origin.chat_id).replace(/^#/, '')}`
  }
  if (channel.kind === 'discord') {
    if (origin.chat_type === 'dm' || !allowed.length) throw new HttpError(400, `Can't post in ${origin.chat_name || 'that Discord chat'} any more.`)
    return origin.chat_name || 'a Discord channel'
  }
  const owner = digits(channel.owner_address)
  const chat = digits(origin.chat_id)
  const ok = chat === owner || (!channel.open && allowed.some((address) => digits(address) === chat))
  if (!ok) throw new HttpError(400, `Can't post in that ${PLATFORM_NAMES[channel.kind]} chat any more.`)
  return chat === owner ? `your ${PLATFORM_NAMES[channel.kind]}` : origin.chat_name || `a ${PLATFORM_NAMES[channel.kind]} chat`
}

function routineOf(row: RoutineRow): Routine {
  const origin = originOf(row)
  return {
    id: row.id, object: 'routine', agentId: row.agent_id, name: row.name, plan: row.plan,
    at: iso(row.at), cron: row.cron, until: iso(row.until), platform: origin.platform, place: origin.place,
    nextRunAt: iso(row.next_run_at), stopped: stoppedOf(row),
    last: row.run_status && row.run_at ? { status: row.run_status, at: new Date(row.run_at).toISOString(), text: row.run_text } : null,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

function stoppedOf(row: RoutineRow): string | null {
  if (row.next_run_at || row.run_status !== 'failed') return null
  return row.cron ? 'Stopped after 3 failed tries' : 'Couldn\'t run'
}

function runText(row: RoutineRow): string {
  const end = row.cron ? ' When this is done for good, say so in one line, then call cancel_routine.' : ' This runs once and ends by itself.'
  return `[Routine ${row.id} · run ${row.run_id}] Time for "${row.name}". Your plan: ${row.plan}\nIf there's nothing worth telling, reply [SILENT].${end}`
}

function originOf(row: RoutineRow): Stored {
  const parsed = JSON.parse(row.origin) as Stored
  return { ...parsed, place: parsed.place ?? '' }
}

function hermesOrigin(origin: Stored): Origin {
  const { place: _place, ...rest } = origin
  return rest
}

function checkedCron(cron: string): string {
  let runs: Date[]
  try {
    runs = new Cron(cron, { timezone: settings.timeZone(), paused: true }).nextRuns(CRON_SAMPLE)
  } catch {
    throw new HttpError(400, `${cron} isn't a cron expression. Use minute hour day month weekday, like 0 9 * * 1-5.`)
  }
  if (runs.length < 2) throw new HttpError(400, 'That cron never repeats. Use at for a one-time routine.')
  const gap = Math.min(...runs.slice(1).map((run, index) => run.getTime() - runs[index].getTime()))
  if (gap < MIN_GAP_MS) throw new HttpError(400, 'Repeat at most every 15 minutes.')
  return cron
}

function nextOf({ cron, after }: { cron: string; after: Date }): Date | null {
  return new Cron(cron, { timezone: settings.timeZone(), paused: true }).nextRun(after)
}

function untilOf({ value, now }: { value: string | undefined; now: Date }): Date {
  const most = new Date(now.getTime() + MAX_DAYS * DAY_MS)
  if (!value) return most
  const until = timeOf({ value, field: 'until' })
  if (until <= now) throw new HttpError(400, 'until has passed. Pick a date in the future.')
  return until > most ? most : until
}

function timeOf({ value, field }: { value: string; field: string }): Date {
  const time = new Date(value)
  if (!OFFSET.test(value) || Number.isNaN(time.getTime())) throw new HttpError(400, `${field} needs an ISO time with an offset, like 2026-11-28T09:00:00+01:00.`)
  return time
}

function validZone(zone: string): boolean {
  try {
    Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function shortTime(date: Date): string {
  return date.toLocaleString('en-US', { timeZone: settings.timeZone(), weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

const digits = (value: string): string => value.replace(/@.*$/, '').replace(/\D/g, '')
const iso = (value: Date | string | null): string | null => value ? new Date(value).toISOString() : null

function changed({ name, agentId, routineId, properties }: { name: string; agentId: string; routineId: string; properties?: Record<string, unknown> }): void {
  emit({ name, target: { type: 'routine', id: routineId, agentId }, properties })
}
