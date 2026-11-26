import { randomBytes } from 'node:crypto'
import type { WebSocket } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import type { Selectable } from 'kysely'
import * as z from 'zod/mini'
import type { Computer, ComputerJoin, RemovedComputer } from '@openhut/common/computers/computer.ts'
import { mux } from '@openhut/common/tunnel/mux.ts'
import { agentd } from '../platform/agentd.ts'
import { config } from '../platform/config.ts'
import { settings } from '../platform/settings.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, sha } from '../platform/secrets.ts'
import { forward, type Link } from '../relay/forward.ts'
import type { Caller } from '../team/identity.ts'
import { HERE } from '../team/home.ts'

const JOIN_MS = 10 * 60_000
const PING_MS = 30_000
const MAX_STREAMS = 512
const HERE_NAME = 'This server'
const UNINSTALL = 'sudo docker rm -f openhut-runtime openhut-runtime-previous openhut-runtime-update; sudo docker volume rm openhut-runtime openhut-runtime-data'
const Hello = z.object({
  type: z.literal('hello'),
  name: z.string().check(z.maxLength(64)),
  version: z.nullable(z.string().check(z.maxLength(64))),
  gvisor: z.nullable(z.boolean()),
  features: z.object({ whatsapp: z.boolean(), browser: z.boolean() }),
  updateError: z.nullable(z.string().check(z.maxLength(500))),
})
type Row = Selectable<Database['computer']>

export const computerService = {
  async list(): Promise<Computer[]> {
    await db.deleteFrom('computer').where('expires_at', '<', new Date()).execute()
    const rows = await db.selectFrom('computer').selectAll().where('expires_at', 'is', null).orderBy('created_at').execute()
    const counts = await agentCounts()
    return Promise.all(rows.sort((a, b) => Number(b.id === HERE) - Number(a.id === HERE)).map((row) => computerOf({ row, agents: counts.get(row.id) ?? 0 })))
  },

  async get({ id }: { id: string }): Promise<Computer> {
    const row = await db.selectFrom('computer').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) throw new HttpError(404, 'That computer isn’t part of this install. Its code may have expired.')
    return computerOf({ row, agents: (await agentCounts()).get(id) ?? 0 })
  },

  async join({ actor }: { actor: Caller }): Promise<ComputerJoin> {
    const address = settings.address()
    if (!address) throw new HttpError(409, 'Set this server’s HTTPS address in Settings › Admin first. Other machines connect to it there.')
    const token = newComputerToken()
    const expiresAt = new Date(Date.now() + JOIN_MS)
    const row = await db.insertInto('computer').values({ id: newId('cm'), name: '', token_hash: sha(token), expires_at: expiresAt }).returningAll().executeTakeFirstOrThrow()
    emit({ name: 'computer.join_started', actor, target: { type: 'computer', id: row.id } })
    return { object: 'computer_join', computer: await computerOf({ row, agents: 0 }), command: `curl -fsSL ${config.releaseUrl} | sh -s -- join ${address} ${token}`, expiresAt: expiresAt.toISOString() }
  },

  async remove({ actor, id }: { actor: Caller; id: string }): Promise<RemovedComputer> {
    if (id === HERE) throw new HttpError(409, 'This server runs OpenHut itself, so it can’t be removed.')
    const computer = await computerService.get({ id })
    if (computer.agents) throw new HttpError(409, `${computer.name} still runs ${computer.agents === 1 ? 'an agent' : `${computer.agents} agents`}. Move ${computer.agents === 1 ? 'it' : 'them'} to another computer first.`)
    await db.deleteFrom('computer').where('id', '=', id).execute()
    forward.unlink({ computer: id, revoked: true })
    emit({ name: 'computer.removed', actor, target: { type: 'computer', id, name: computer.name } })
    return { id, object: 'computer', deleted: true, uninstall: UNINSTALL }
  },

  async boot(): Promise<void> {
    const hash = config.hereTokenSha256 ?? sha(newComputerToken())
    await db.insertInto('computer').values({ id: HERE, name: HERE_NAME, token_hash: hash, expires_at: null })
      .onConflict((oc) => oc.column('id').doUpdateSet({ token_hash: hash })).execute()
  },

  async link({ socket, req, onHello }: { socket: WebSocket; req: FastifyRequest; onHello: (computer: string) => Promise<void> }): Promise<void> {
    const found = await admit(/^Bearer (\S{20,200})$/.exec(req.headers.authorization ?? '')?.[1])
    if (!found) return socket.close(4401, 'This computer’s code is wrong, expired or removed. Add it again from Settings › Computers.')
    const { row, token } = found
    if (socket.readyState !== socket.OPEN) return
    let alive = true
    let streams = 0
    const ping = setInterval(() => {
      if (!alive) return socket.terminate()
      alive = false
      socket.ping()
    }, PING_MS)
    const link: Link = {
      features: { whatsapp: false, browser: false },
      gvisor: null,
      end: (revoked) => revoked ? socket.close(4401, 'This computer was removed from the install.') : socket.close(4000, 'Another connection with this computer’s token replaced this one.'),
      mux: mux({
        odd: false,
        send: (bytes, done) => socket.send(bytes, (err) => done(err ?? undefined)),
        accept: (open, stream) => {
          if (open.to !== 'gateway' || ++streams > MAX_STREAMS) return stream.destroy()
          stream.once('close', () => { streams-- })
          forward.gateway({ computer: row.id, stream })
        },
        heard: (message) => {
          const hello = z.safeParse(Hello, message)
          if (!hello.success) return
          void hear({ row, link, hello: hello.data }).then(() => onHello(row.id)).catch((err: unknown) => log.warn({ event: 'computer.hello_failed', computer: row.id, error: messageOf(err) }))
        },
      }),
    }
    socket.on('pong', () => { alive = true })
    socket.on('message', (data, binary) => {
      try {
        if (!binary) throw new Error('The runtime sent text on the link.')
        link.mux.receive(new Uint8Array(data as Buffer))
      } catch (err) {
        log.warn({ event: 'computer.link_broken', computer: row.id, error: messageOf(err) })
        socket.terminate()
      }
    })
    socket.on('close', () => {
      clearInterval(ping)
      link.mux.close()
      forward.unlink({ computer: row.id, link })
      void db.updateTable('computer').set({ seen_at: new Date() }).where('id', '=', row.id).execute().catch(() => undefined)
      emit({ name: 'computer.offline', target: { type: 'computer', id: row.id } })
    })
    forward.link({ computer: row.id, link })
    link.mux.say({ type: 'welcome', runtimeImage: config.runtimeImage, runtimeHash: config.runtimeHash, ...token && { token } })
  },
}

export function newComputerToken(): string {
  return `ohj_${randomBytes(32).toString('base64url')}`
}

export async function admit(token: string | undefined): Promise<{ row: Row; token?: string } | undefined> {
  if (!token) return undefined
  const row = await db.selectFrom('computer').selectAll().where('token_hash', '=', sha(token)).executeTakeFirst()
  if (!row) return undefined
  if (!row.expires_at) return { row }
  if (new Date(row.expires_at) < new Date()) {
    await db.deleteFrom('computer').where('id', '=', row.id).execute()
    return undefined
  }
  const next = newComputerToken()
  const claimed = await db.updateTable('computer').set({ token_hash: sha(next), expires_at: null }).where('id', '=', row.id).where('token_hash', '=', row.token_hash).where('expires_at', 'is not', null).returningAll().executeTakeFirst()
  return claimed && { row: claimed, token: next }
}

async function hear({ row, link, hello }: { row: Row; link: Link; hello: z.output<typeof Hello> }): Promise<void> {
  link.features = hello.features
  link.gvisor = hello.gvisor
  const said = hello.name.replace(/[^\w.-]/g, '').slice(0, 64)
  const name = row.id === HERE ? said || HERE_NAME : row.name || said || 'Computer'
  await db.updateTable('computer').set({ name, version: hello.version, gvisor: hello.gvisor, update_error: hello.updateError, seen_at: new Date() }).where('id', '=', row.id).execute()
  emit({ name: 'computer.online', target: { type: 'computer', id: row.id, version: hello.version } })
}

async function agentCounts(): Promise<Map<string, number>> {
  const rows = await db.selectFrom('agent').select(['runs_on']).execute()
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.runs_on ?? HERE, (counts.get(row.runs_on ?? HERE) ?? 0) + 1)
  return counts
}

async function computerOf({ row, agents }: { row: Row; agents: number }): Promise<Computer> {
  const link = forward.linked(row.id)
  const online = forward.online(row.id)
  const local = online && !link ? await agentd.health({ on: row.id }).catch(() => undefined) : undefined
  return {
    id: row.id, object: 'computer', name: row.name || 'New computer', here: row.id === HERE, joined: !row.expires_at, online, version: row.version, gvisor: link?.gvisor ?? local?.gvisor ?? row.gvisor,
    features: link?.features ?? local?.features ?? { whatsapp: false, browser: false }, updateError: row.update_error, agents, seenAt: row.seen_at ? new Date(row.seen_at).toISOString() : null,
  }
}
