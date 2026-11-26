import * as z from 'zod'
import { sql, type Kysely, type Selectable } from 'kysely'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ApproveAsk, ASK_PROMPT, DeclineAsk, ListAsks, type Ask } from '@openhut/common/asks/ask.ts'
import { agentService } from '../server/agents/agent-service.ts'
import { Origin } from '../server/inbox/routines.ts'
import { allowOnly, db } from '../server/platform/db.ts'
import type { Database } from '../server/platform/db-schema.ts'
import { emit, log } from '../server/platform/events.ts'
import { HttpError, messageOf } from '../server/platform/http-error.ts'
import { IdParams, listOf } from '../server/platform/responses.ts'
import { newId } from '../server/platform/secrets.ts'
import { who, type Caller } from '../server/team/identity.ts'
import { APP_PLATFORM, defineTool, type AskKind, type Plugin, type Tool } from './plugin.ts'
import { plugins } from './plugins.ts'
import { wakes } from './wakes.ts'

const BATCH_MS = 30_000
const SWEEP_MS = 60_000
const STATUSES = ['open', 'done', 'declined', 'expired'] as const
const running = new Map<string, Promise<Ask>>()

type Row = Selectable<Database['ask']>
type Kind = AskKind<z.ZodObject, z.ZodObject | undefined>

export const asks = {
  async create({ agentId, kind, input, why, origin, expires }: { agentId: string; kind: string; input: unknown; why: string; origin: unknown; expires?: Date }): Promise<string> {
    const from = z.safeParse(Origin, origin)
    if (!from.success) throw new HttpError(400, 'You can only ask from a chat you\'re in.')
    const parsed = kindOf(kind).input.safeParse(input)
    if (!parsed.success) throw new HttpError(400, `That ask isn't valid. ${z.prettifyError(parsed.error)}`)
    const same = JSON.stringify(parsed.data)
    const open = await db.selectFrom('ask').selectAll().where('agent_id', '=', agentId).where('kind', '=', kind).where('status', '=', 'open').where('input', '=', same).executeTakeFirst()
    const row = open ?? await db.insertInto('ask').values({
      id: newId('ask'), agent_id: agentId, kind, input: same, title: await kindOf(kind).title({ agentId, input: parsed.data }), why, origin: JSON.stringify(from.data), expires_at: expires ?? null,
    }).returningAll().executeTakeFirstOrThrow()
    if (!open) emit({ name: 'ask.created', target: { type: 'ask', id: row.id, agentId, kind } })
    const expiry = row.expires_at ? ` If nobody answers in ${Math.round((new Date(row.expires_at).getTime() - Date.now()) / 60_000)} minutes it expires; carry on without it.` : ''
    return `Asked for approval (${row.id}): ${row.title}. Nothing has changed yet.${expiry} Tell the person in one line that it waits for your owner's approval in OpenHut, then stop. The answer comes back to you as a message.`
  },

  approve({ actor, id, answer }: { actor: Caller; id: string; answer?: unknown }): Promise<Ask> {
    const inFlight = running.get(id)
    if (inFlight) return inFlight.catch(() => undefined).then(async () => askOf(await owned({ actor, id })))
    const run = approving({ actor, id, answer }).finally(() => running.delete(id))
    running.set(id, run)
    return run
  },

  async decline({ actor, id, note }: { actor: Caller; id: string; note?: string }): Promise<Ask> {
    const row = await owned({ actor, id })
    if (row.status !== 'open') return askOf(row)
    const said = note?.trim() || null
    await kinds()[row.kind]?.declined?.({ actor, ask: askFor(row) })
    const reply = `Not approved: ${row.title}.${said ? ` They said: "${said}"` : ''} Nothing changed. Don't ask again unless they bring it up.`
    return answered({ actor, row, status: 'declined', set: { note: said, reply } })
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Ask> {
    return askOf(await owned({ actor, id }))
  },

  async list({ agentId }: { agentId: string }): Promise<Ask[]> {
    await sweep()
    const rows = await db.selectFrom('ask').selectAll().where('agent_id', '=', agentId).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(50).execute()
    return rows.map(askOf)
  },

  async inChat({ agentId, since }: { agentId: string; since: Date }): Promise<string[]> {
    const rows = await db.selectFrom('ask').select(['id', 'origin']).where('agent_id', '=', agentId).where('created_at', '>=', since).orderBy('created_at').execute()
    return rows.filter(inApp).map((row) => row.id)
  },

  sweep,
}

export function asksPlugin(list: Plugin[]): Plugin {
  const names = list.flatMap((plugin) => Object.keys(plugin.asks ?? {}))
  const clash = names.find((name, index) => names.indexOf(name) !== index)
  if (clash) throw new HttpError(500, `Two plugins define the ask ${clash}.`)
  const tools: Record<string, Tool> = Object.fromEntries(list.flatMap((plugin) => Object.entries(plugin.asks ?? {})).flatMap(([name, kind]) => kind.tool ? [[name, toolOf({ name, kind, description: kind.tool })]] : []))
  return {
    name: 'asks',
    migrate: createTables,
    routes: () => ({ '/api/asks': controller }),
    hermes: () => ({ prompt: ASK_PROMPT }),
    tools,
    afterTurn: async ({ agentId, since }) => {
      const ids = await asks.inChat({ agentId, since })
      return ids.length ? { type: 'data-asks', data: ids } : undefined
    },
    wakes: {
      due: async ({ agentId }) => {
        await sweep()
        await batch(agentId)
        const rows = await db.selectFrom('ask').selectAll().where('agent_id', '=', agentId).where('told', '=', false).where('wake_id', 'is not', null).orderBy('answered_at').execute()
        const open = await db.selectFrom('ask').select(['origin', 'title']).where('agent_id', '=', agentId).where('status', '=', 'open').execute()
        return [...grouped({ rows, by: (row) => row.wake_id ?? '' })].map(([id, told]) => ({ id, text: noteOf({ told, open: open.filter((each) => each.origin === told[0].origin) }), origin: originOf(told[0]) }))
      },
      picked: async ({ agentId, id }) => {
        const done = await db.updateTable('ask').set({ told: true }).where('agent_id', '=', agentId).where('wake_id', '=', id).returning('id').execute()
        if (!done.length) throw new HttpError(404, `No answered asks in ${id}.`)
      },
    },
    start: () => void setInterval(() => void sweep().catch((err: unknown) => log.warn({ event: 'ask.sweep_failed', error: messageOf(err) })), SWEEP_MS).unref(),
  }
}

function toolOf({ name, kind, description }: { name: string; kind: Kind; description: string }): Tool {
  return defineTool({
    description: `${description} Your owner approves it in OpenHut first: the call returns at once, and the answer comes back to you as a message.`,
    input: { why: z.string().min(1).max(300).describe('One sentence for your owner: why, in plain words.'), ...kind.input.shape },
    run: async ({ why, ...input }, { agent, origin }) => asks.create({ agentId: agent.id, kind: name, input, why: String(why), origin }),
  })
}

async function approving({ actor, id, answer }: { actor: Caller; id: string; answer?: unknown }): Promise<Ask> {
  const row = await owned({ actor, id })
  if (row.status !== 'open') return askOf(row)
  const kind = kinds()[row.kind]
  if (!kind) throw new HttpError(409, 'OpenHut can\'t do this kind of ask any more.')
  const input = JSON.parse(row.input) as Record<string, unknown>
  const given = kind.answer ? kind.answer.safeParse(answer ?? pick({ from: input, keys: Object.keys(kind.answer.shape) })) : undefined
  if (given && !given.success) throw new HttpError(400, `That answer isn't valid. ${z.prettifyError(given.error)}`)
  const edits = given?.data ? pick({ from: given.data, keys: Object.keys(kind.input.shape) }) : {}
  const final = { ...input, ...edits }
  const title = Object.keys(edits).length ? await kind.title({ agentId: row.agent_id, input: final }) : row.title
  const note = await kind.run({ actor, ask: { ...askFor(row), input: final }, answer: given?.data })
  return answered({ actor, row, status: 'done', set: { input: JSON.stringify(final), title, reply: `Approved and done: ${title}.${note ? ` ${note}` : ''}` } })
}

async function answered({ actor, row, status, set }: { actor?: Caller; row: Row; status: 'done' | 'declined'; set: Partial<Pick<Row, 'input' | 'title' | 'note' | 'reply'>> }): Promise<Ask> {
  const done = await db.updateTable('ask').set({ ...set, status, told: false, answered_at: new Date() }).where('id', '=', row.id).where('status', '=', 'open').returningAll().executeTakeFirst()
  if (!done) return askOf(await db.selectFrom('ask').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow())
  told(done)
  emit({ name: `ask.${status}`, actor, target: { type: 'ask', id: row.id, agentId: row.agent_id, kind: row.kind } })
  return askOf(done)
}

async function sweep(): Promise<void> {
  const names = Object.keys(kinds())
  const now = new Date()
  const late = await db.updateTable('ask').set((eb) => ({ status: 'expired', answered_at: now, told: false, reply: sql<string>`${'Nobody answered in time: '} || ${eb.ref('title')} || ${' didn\'t happen. Carry on without it, and say in your report that it needs your owner\'s OK.'}` }))
    .where('status', '=', 'open').where('expires_at', '<', now).returningAll().execute()
  const gone = await db.updateTable('ask').set((eb) => ({ status: 'expired', answered_at: now, told: false, reply: sql<string>`${eb.ref('title')} || ${' didn\'t happen: OpenHut can\'t do this kind of ask any more.'}` }))
    .where('status', '=', 'open').where('kind', 'not in', names.length ? names : ['']).returningAll().execute()
  for (const row of [...late, ...gone]) told(row)
}

function told(row: Row): void {
  if (!inApp(row)) return
  wakes.nudge(row.agent_id)
  setTimeout(() => wakes.nudge(row.agent_id), BATCH_MS + 1000).unref()
}

async function batch(agentId: string): Promise<void> {
  const answered = await db.selectFrom('ask').select(['id', 'origin', 'answered_at']).where('agent_id', '=', agentId).where('told', '=', false).where('status', '<>', 'open').where('wake_id', 'is', null).execute()
  const open = new Set((await db.selectFrom('ask').select('origin').where('agent_id', '=', agentId).where('status', '=', 'open').execute()).map((row) => row.origin))
  for (const [origin, rows] of grouped({ rows: answered, by: (row) => row.origin })) {
    const last = Math.max(...rows.map((row) => new Date(row.answered_at ?? 0).getTime()))
    if (open.has(origin) && Date.now() - last < BATCH_MS) continue
    await db.updateTable('ask').set({ wake_id: newId('wk') }).where('id', 'in', rows.map((row) => row.id)).where('wake_id', 'is', null).execute()
  }
}

function grouped<T>({ rows, by }: { rows: T[]; by: (row: T) => string }): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(by(row), [...groups.get(by(row)) ?? [], row])
  return groups
}

function noteOf({ told, open }: { told: Row[]; open: { title: string }[] }): string {
  const head = told.length === 1 ? 'Your owner answered your ask:' : `Your owner answered ${told.length} of your asks:`
  const waiting = open.length ? `\nStill waiting for: ${open.map((each) => each.title).join('; ')}.` : ''
  return `${head}\n${told.map((row) => `- ${row.reply ?? row.title}`).join('\n')}${waiting}\nTell the chat in a line or two what changed, with the final values if they differ from what you asked for, then carry on with the job.`
}

async function owned({ actor, id }: { actor: Caller; id: string }): Promise<Row> {
  await sweep()
  const row = await db.selectFrom('ask').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw new HttpError(404, 'That ask doesn\'t exist.')
  await agentService.requireOwner({ actor, id: row.agent_id })
  return row
}

function kinds(): Record<string, Kind> {
  return Object.fromEntries(plugins().flatMap((plugin) => Object.entries(plugin.asks ?? {})))
}

function kindOf(name: string): Kind {
  const kind = kinds()[name]
  if (!kind) throw new HttpError(500, `No plugin defines the ask ${name}.`)
  return kind
}

function pick({ from, keys }: { from: Record<string, unknown>; keys: string[] }): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => from[key] !== undefined).map((key) => [key, from[key]]))
}

function askFor(row: Row) {
  return { id: row.id, agentId: row.agent_id, input: JSON.parse(row.input) as Record<string, unknown>, why: row.why, origin: originOf(row) }
}

function inApp(row: Pick<Row, 'origin'>): boolean {
  return originOf(row).platform === APP_PLATFORM
}

function originOf(row: Pick<Row, 'origin'>): Origin {
  return JSON.parse(row.origin) as Origin
}

function askOf(row: Row): Ask {
  const answer = kinds()[row.kind]?.answer
  const form = answer && row.status === 'open' ? z.toJSONSchema(answer, { io: 'input' }) : undefined
  return {
    id: row.id, object: 'ask', kind: row.kind, agentId: row.agent_id, title: row.title, why: row.why, input: JSON.parse(row.input) as Record<string, unknown>,
    status: row.status, note: row.note, ...form && { form }, createdAt: row.created_at.toISOString(), answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : null,
  }
}

const controller: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: ListAsks } }, async (req) => {
    await agentService.requireVisible({ actor: await who(req), id: req.query.agentId })
    return listOf({ req, data: await asks.list({ agentId: req.query.agentId }) })
  })
  app.post('/:id/approvals', { schema: { params: IdParams, body: ApproveAsk } }, async (req) => asks.approve({ actor: await who(req), id: req.params.id, answer: req.body?.answer }))
  app.post('/:id/declines', { schema: { params: IdParams, body: DeclineAsk } }, async (req) => asks.decline({ actor: await who(req), id: req.params.id, note: req.body?.note }))
}

async function createTables(database: Kysely<Database>): Promise<void> {
  await sql`create table if not exists ask (
    id text primary key, agent_id text not null references agent(id) on delete cascade, kind text not null, input text not null, title text not null, why text not null,
    origin text not null, status text not null default 'open', note text, reply text, told boolean not null default false, created_at timestamptz not null default now(),
    answered_at timestamptz, expires_at timestamptz)`.execute(database)
  await sql`alter table ask add column if not exists wake_id text`.execute(database)
  await sql`create index if not exists ask_by_agent on ask (agent_id, created_at desc)`.execute(database)
  await allowOnly({ table: 'ask', column: 'status', values: STATUSES })
  const { rows } = await sql<{ found: string | null }>`select to_regclass('change_request')::text as found`.execute(database)
  if (!rows[0]?.found) return
  await sql`alter table change_request add column if not exists expires_at timestamptz, add column if not exists result text`.execute(database)
  await sql`insert into ask (id, agent_id, kind, input, title, why, origin, status, note, reply, told, created_at, answered_at, expires_at)
    select id, agent_id, action, input, summary, why, origin,
      case status when 'pending' then 'open' when 'approved' then 'done' when 'denied' then 'declined' else 'expired' end, note,
      case status when 'approved' then 'Approved and done: ' || summary || '.' || coalesce(' The result: ' || result, '')
        when 'denied' then 'Not approved: ' || summary || '.' || coalesce(' They said: "' || note || '"', '')
        when 'expired' then 'Nobody answered in time: ' || summary || ' didn''t happen.' end,
      told, created_at, decided_at, expires_at
    from change_request where agent_id in (select id from agent) on conflict (id) do nothing`.execute(database)
}
