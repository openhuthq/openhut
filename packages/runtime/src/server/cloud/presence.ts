import * as z from 'zod/mini'
import { HereField, parseJson, type Member, type Presence, type SetHere } from '@openhut/common/cloud/cloud.ts'
import { padded } from '@openhut/common/records/seal.ts'
import { fromBase64, lock, toBase64, unlock, type Bytes } from '@openhut/common/vault/vault.ts'
import { hold } from '../platform/cloud.ts'
import { emit } from '../platform/events.ts'

const LIFE_MS = 30_000
const BEAT_MS = 10_000
const TYPING_MS = 3000
const TYPING_LIFE_MS = 8000
const TICK_MS = 1000
const HERE_BYTES = 512

export const HereValue = z.object({
  agent: z.nullable(z.string().check(z.maxLength(40))),
  field: z.nullable(HereField),
  typing: z.boolean(),
  at: z.number().check(z.int()),
  list: z.number().check(z.int(), z.minimum(0)),
  listHash: z.string().check(z.maxLength(43)),
})
export type HereValue = z.infer<typeof HereValue>

export type HereContext = { workspace: string; key: Bytes; version: number; keys: Record<number, Bytes>; me: string; members: Member[]; email: string; list: number; listHash: string }
export type HereIo = { rooms: () => string[]; roomOf: (agent: string) => Promise<string | null>; context: (ws: string) => Promise<HereContext | null>; send: (input: { ws: string; body: string }) => boolean; catchUp: (ws: string) => void }
type Seen = { email: string; agent: string | null; field: HereField | null; typing: boolean; since: number; heardAt: number; typingAt: number; sentAt: number }
type State = Pick<SetHere, 'agent' | 'field' | 'typing'>
type Last = { state: State; at: number }

let io: HereIo | null = null
let mine: SetHere & { ws: string | null; postedAt: number; since: number | null } = { agent: null, field: null, typing: false, ws: null, postedAt: 0, since: null }
const sent = new Map<string, Last>()
const seen = new Map<string, Map<string, Seen>>()
const behind = new Map<string, number>()
const mismatched = new Map<string, Set<string>>()

let ticking: Promise<void> = Promise.resolve()

setInterval(() => void tick(), TICK_MS).unref()

export const presence = {
  wire(next: HereIo): void {
    io = next
  },

  async set(next: SetHere): Promise<void> {
    const ws = next.agent && io ? await io.roomOf(next.agent) : null
    const agent = ws ? next.agent : null
    if (agent !== mine.agent || next.field !== mine.field) mine.since = null
    mine = { ...mine, agent, field: agent ? next.field : null, typing: Boolean(agent) && next.typing, ws, postedAt: Date.now() }
    await tick()
  },

  ready(ws: string): void {
    if (mine.ws === ws) mine.since = null
    stale(ws)
  },

  closed(ws: string): void {
    if (mine.ws === ws) mine.since = null
    if (seen.delete(ws)) changed()
  },

  members({ ws, emails }: { ws: string; emails: string[] }): void {
    const left = [...mismatched.get(ws) ?? []].filter((email) => !emails.includes(email))
    for (const email of left) flag({ ws, email, on: false })
  },

  gone({ ws, from }: { ws: string; from: string }): void {
    if (seen.get(ws)?.delete(from)) changed()
  },

  async heard({ ws, from, at, body }: { ws: string; from: string; at: number; body: string }): Promise<void> {
    const ctx = io && await io.context(ws)
    const value = ctx && await openHere({ workspace: ws, keys: ctx.keys, from, body })
    if (!ctx || !value) return
    if (from === ctx.me) {
      if (mine.since !== null || !value.field || value.agent !== mine.agent || value.field !== mine.field) return
      mine.since = at
      return changed()
    }
    const email = ctx.members.find((member) => member.devices.includes(from))?.email
    const room = seen.get(ws) ?? new Map<string, Seen>()
    const before = room.get(from)
    if (!email || email === ctx.email || (before && value.at <= before.sentAt)) return
    compare({ ws, from, email, value, ctx })
    const same = before && before.agent === value.agent && before.field === value.field && value.field
    room.set(from, { email, agent: value.agent, field: value.field, typing: value.typing, since: same ? before.since : at, heardAt: Date.now(), typingAt: value.typing ? Date.now() : 0, sentAt: value.at })
    seen.set(ws, room)
    if (!before) stale(ws)
    changed()
  },

  view(): Presence {
    const people = [...seen.values()].flatMap((room) => [...room.values()]).flatMap((each) => each.agent ? [{ email: each.email, agentId: each.agent, field: each.field, typing: each.typing, since: each.since }] : [])
    const mismatch = [...mismatched].flatMap(([workspace, emails]) => [...emails].map((email) => ({ workspace, email })))
    return { object: 'presence', since: mine.since, people, mismatch }
  },

  forget(): void {
    seen.clear()
    sent.clear()
    behind.clear()
    for (const ws of mismatched.keys()) hold({ workspace: ws, on: false })
    mismatched.clear()
    changed()
  },
}

function compare({ ws, from, email, value, ctx }: { ws: string; from: string; email: string; value: HereValue; ctx: HereContext }): void {
  const forked = value.list === ctx.list && value.listHash !== ctx.listHash
  const key = `${ws}/${from}`
  const ahead = value.list > ctx.list
  const lagging = ahead && ctx.list < (behind.get(key) ?? 0)
  if (ahead) {
    behind.set(key, value.list)
    io?.catchUp(ws)
  } else behind.delete(key)
  if (forked || lagging) flag({ ws, email, on: true })
  else if (value.list === ctx.list) flag({ ws, email, on: false })
}

function flag({ ws, email, on }: { ws: string; email: string; on: boolean }): void {
  const emails = mismatched.get(ws) ?? new Set<string>()
  const was = emails.size
  if (on) emails.add(email)
  else emails.delete(email)
  if (emails.size) mismatched.set(ws, emails)
  else mismatched.delete(ws)
  if (Boolean(was) !== Boolean(emails.size)) hold({ workspace: ws, on: emails.size > 0 })
}

function tick(): Promise<void> {
  ticking = ticking.then(step).catch(() => undefined)
  return ticking
}

async function step(): Promise<void> {
  if (!io) return
  const now = Date.now()
  if (mine.agent && now - mine.postedAt > LIFE_MS) mine = { ...mine, agent: null, field: null, typing: false, ws: null, since: null }
  let dropped = false
  for (const room of seen.values()) {
    for (const [from, each] of room) {
      if (now - each.heardAt > LIFE_MS) {
        room.delete(from)
        dropped = true
      } else if (each.typing && now - each.typingAt > TYPING_LIFE_MS) {
        each.typing = false
        dropped = true
      }
    }
  }
  if (dropped) changed()
  for (const ws of io.rooms()) await sendTo({ ws, now })
}

async function sendTo({ ws, now }: { ws: string; now: number }): Promise<void> {
  const here = mine.ws === ws
  const state: State = { agent: here ? mine.agent : null, field: here ? mine.field : null, typing: here && mine.typing }
  const ctx = due({ state, last: sent.get(ws), now }) && io ? await io.context(ws) : null
  if (!ctx || !io) return
  const body = await lockHere({ workspace: ws, key: ctx.key, version: ctx.version, from: ctx.me, value: { ...state, at: now, list: ctx.list, listHash: ctx.listHash } })
  if (body && io.send({ ws, body })) sent.set(ws, { state, at: now })
}

function due({ state, last, now }: { state: State; last: Last | undefined; now: number }): boolean {
  if (!last) return Boolean(state.agent)
  const moved = last.state.agent !== state.agent || last.state.field !== state.field
  if (moved) return true
  if (last.state.typing !== state.typing) return now - last.at >= TYPING_MS
  return Boolean(state.agent) && now - last.at >= (state.typing ? TYPING_MS : BEAT_MS)
}

function stale(ws: string): void {
  const last = sent.get(ws)
  if (last) sent.set(ws, { ...last, at: 0 })
}

export async function lockHere({ workspace, key, version, from, value }: { workspace: string; key: Bytes; version: number; from: string; value: HereValue }): Promise<string | null> {
  const plain = HereValue.safeParse(value).success ? padded({ json: JSON.stringify(value), size: HERE_BYTES }) : null
  const locked = plain && await lock({ key, version, bind: hereBind({ workspace, from }), plain })
  return locked ? toBase64(locked) : null
}

export async function openHere({ workspace, keys, from, body }: { workspace: string; keys: Record<number, Bytes>; from: string; body: string }): Promise<HereValue | null> {
  const plain = await unlock({ keys, bind: hereBind({ workspace, from }), locked: fromBase64(body) })
  return plain?.length === HERE_BYTES ? HereValue.safeParse(parseJson(new TextDecoder().decode(plain))).data ?? null : null
}

function hereBind({ workspace, from }: { workspace: string; from: string }): string {
  return `workspace/${workspace}/here/${from}`
}

function changed(): void {
  emit({ name: 'presence.changed', target: { type: 'presence', id: 'here' } })
}
