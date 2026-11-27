import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { extname } from 'node:path'
import { sql, type Selectable } from 'kysely'
import type { Artifact, ArtifactAccess, ArtifactCard, ArtifactKind, ArtifactView, SharedArtifact, UpdateArtifact } from '@openhut/common/artifacts.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import { db } from '../../server/platform/db.ts'
import type { Database } from '../../server/platform/db-schema.ts'
import { HttpError } from '../../server/platform/http-error.ts'
import { keyFor } from '../../server/platform/secrets.ts'
import type { Caller } from '../../server/team/identity.ts'

export const MAX_FILES = 200
export const MAX_BYTES = 10 * 1024 * 1024
const READ_BYTES = 400 * 1024
const SIGNED_MS = 12 * 60 * 60_000
const HOUR_MS = 60 * 60_000
const KEPT_MS = 60 * 60_000
const key = keyFor('artifacts')
const shown = new Map<string, { at: number; card: ArtifactCard }>()

type Row = Selectable<Database['artifact']>
type FileInput = { path: string; text?: string; base64?: string }
export type Role = 'manage' | 'view' | undefined

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip',
}
const KINDS: Record<string, ArtifactKind> = { '.html': 'page', '.htm': 'page', '.pdf': 'pdf', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image', '.md': 'md' }

export const typeOf = (path: string): string => TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
export const kindOf = (entry: string): ArtifactKind => KINDS[extname(entry).toLowerCase()] ?? 'file'
const isText = (type: string): boolean => type.includes('charset=utf-8') || type === 'image/svg+xml'

export function cleanPath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.')
  if (parts.includes('..')) throw new HttpError(400, `${path} goes outside the artifact. Use a path like assets/chart.js.`, { param: 'files' })
  const clean = parts.join('/')
  if (!clean || clean.length > 200) throw new HttpError(400, `${path || 'A file'} needs a path of 1 to 200 characters, like index.html.`, { param: 'files' })
  return clean
}

export function roleOf({ uses, email, holdsToken, access, people }: { uses: boolean; email?: string; holdsToken?: boolean; access: ArtifactAccess; people: string[] }): Role {
  if (uses) return 'manage'
  if (email && (people.includes(email.toLowerCase()) || access !== 'private')) return 'view'
  if (access === 'link' && holdsToken) return 'view'
  return undefined
}

export function sign({ id, now = Date.now() }: { id: string; now?: number }): string {
  const exp = Math.ceil((now + SIGNED_MS) / HOUR_MS) * HOUR_MS / 1000
  return `${exp}.${mac({ id, exp })}`
}

export function verify({ id, sig, now = Date.now() }: { id: string; sig: string; now?: number }): boolean {
  const [exp, given = ''] = sig.split('.')
  if (!/^\d+$/.test(exp ?? '') || Number(exp) * 1000 <= now) return false
  const expected = Buffer.from(mac({ id, exp: Number(exp) }))
  const actual = Buffer.from(given)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const mac = ({ id, exp }: { id: string; exp: number }): string => createHmac('sha256', key).update(`${id}.${exp}`).digest('base64url')
const srcOf = ({ id, entry }: { id: string; entry: string }): string => `/a/${id}/${sign({ id })}/${entry.split('/').map(encodeURIComponent).join('/')}`
const newArtifactId = (): string => `art_${randomBytes(18).toString('base64url').replace(/[-_]/g, 'x').toLowerCase()}`
const newShareToken = (): string => randomBytes(24).toString('base64url')
const missing = (): HttpError => new HttpError(404, 'That artifact doesn’t exist, or you can’t open it.')
const notYours = (id: string): HttpError => new HttpError(404, `You have no artifact ${id}. Check list_artifacts.`, { param: 'artifact' })
const titleIn = (html: string): string | undefined => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim().slice(0, 80) || undefined
const uses = ({ actor, agentId }: { actor: Caller; agentId: string }): Promise<boolean> => agentService.requireUse({ actor, id: agentId }).then(() => true, () => false)

async function sizes(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map()
  const rows = await db.selectFrom('artifact_file').innerJoin('artifact', 'artifact.id', 'artifact_file.artifact_id')
    .select(['artifact.id', sql<number>`octet_length(artifact_file.body)`.as('size')])
    .where('artifact.id', 'in', ids).whereRef('artifact_file.path', '=', 'artifact.entry').execute()
  return new Map(rows.map((row) => [row.id, Number(row.size)]))
}

function artifactOf({ row, size }: { row: Row; size: number }): Artifact {
  return { id: row.id, title: row.title, kind: kindOf(row.entry), access: row.access, size, agentId: row.agent_id, entry: row.entry, ver: row.ver, createdBy: row.created_by, updatedAt: new Date(row.updated_at).toISOString() }
}

async function artifactsOf(rows: Row[]): Promise<Artifact[]> {
  const sized = await sizes(rows.map((row) => row.id))
  return rows.map((row) => artifactOf({ row, size: sized.get(row.id) ?? 0 }))
}

function bodyOf(file: FileInput): Buffer {
  if ((file.text === undefined) === (file.base64 === undefined)) throw new HttpError(400, `Send ${file.path} as text or as base64, not both or neither.`, { param: 'files' })
  return file.text === undefined ? Buffer.from(file.base64 ?? '', 'base64') : Buffer.from(file.text)
}

async function found(id: string): Promise<Row> {
  const row = await db.selectFrom('artifact').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw missing()
  return row
}

async function managed({ actor, id }: { actor: Caller; id: string }): Promise<Row> {
  const row = await found(id)
  const role = roleOf({ uses: await uses({ actor, agentId: row.agent_id }), email: actor.email, access: row.access, people: row.people })
  if (!role) throw missing()
  if (role !== 'manage') throw new HttpError(403, 'Only people who can use this agent can share or delete this.')
  return row
}

async function changeAccess({ row, access, add = [], remove = [] }: { row: Row; access?: ArtifactAccess } & Omit<UpdateArtifact, 'access'>): Promise<Row> {
  const next = access ?? row.access
  const gone = new Set(remove.map((email) => email.toLowerCase()))
  const people = [...new Set([...row.people, ...add.map((email) => email.toLowerCase())])].filter((email) => !gone.has(email))
  const shareToken = next === 'link' ? row.share_token ?? newShareToken() : null
  return db.updateTable('artifact').set({ access: next, people, share_token: shareToken, updated_at: new Date() }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow()
}

async function viewOf({ row, canManage }: { row: Row; canManage: boolean }): Promise<ArtifactView> {
  const [artifact] = await artifactsOf([row])
  return { ...artifact!, src: srcOf(row), canManage, people: canManage ? row.people : [], ...canManage && row.access === 'link' && row.share_token && { shareUrl: `/share/${row.share_token}` } }
}

export const artifactService = {
  async publish({ agentId, threadId, createdBy, artifact, title, files, remove = [], ver }: { agentId: string; threadId?: string; createdBy: string; artifact?: string; title?: string; files: FileInput[]; remove?: string[]; ver?: number }): Promise<Artifact> {
    const bodies = files.map((file) => ({ path: cleanPath(file.path), body: bodyOf(file) }))
    const removed = remove.map(cleanPath)
    const row = await db.transaction().execute(async (trx) => {
      const existing = artifact ? await trx.selectFrom('artifact').selectAll().where('id', '=', artifact).where('agent_id', '=', agentId).forUpdate().executeTakeFirst() : undefined
      if (artifact && !existing) throw notYours(artifact)
      if (existing && ver !== undefined && ver !== existing.ver) throw new HttpError(409, `Changed since you read it (now v${existing.ver}). Read it again.`, { param: 'ver' })
      const entry = existing?.entry ?? newEntry(bodies.map((file) => file.path))
      const sent = bodies.find((file) => file.path === entry)
      const named = title?.trim() || (!existing?.titled && sent && kindOf(entry) === 'page' ? titleIn(sent.body.toString()) : undefined)
      const saved = existing
        ? await trx.updateTable('artifact').set({ title: named ?? existing.title, titled: existing.titled || !!title?.trim(), ver: existing.ver + 1, updated_at: new Date() }).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow()
        : await trx.insertInto('artifact').values({ id: newArtifactId(), agent_id: agentId, created_by: createdBy, title: named ?? entry.split('/').at(-1)!, titled: !!title?.trim(), entry }).returningAll().executeTakeFirstOrThrow()
      if (removed.length) await trx.deleteFrom('artifact_file').where('artifact_id', '=', saved.id).where('path', 'in', removed).execute()
      for (const file of bodies) {
        await trx.insertInto('artifact_file').values({ artifact_id: saved.id, path: file.path, type: typeOf(file.path), body: file.body })
          .onConflict((conflict) => conflict.columns(['artifact_id', 'path']).doUpdateSet((eb) => ({ type: eb.ref('excluded.type'), body: eb.ref('excluded.body') }))).execute()
      }
      const totals = await trx.selectFrom('artifact_file').select([sql<number>`count(*)`.as('count'), sql<number>`coalesce(sum(octet_length(body)), 0)`.as('bytes'), sql<boolean>`bool_or(path = ${entry})`.as('hasEntry')])
        .where('artifact_id', '=', saved.id).executeTakeFirstOrThrow()
      if (Number(totals.count) > MAX_FILES) throw new HttpError(400, `An artifact holds at most ${MAX_FILES} files. Remove some and publish again.`, { param: 'files' })
      if (Number(totals.bytes) > MAX_BYTES) throw new HttpError(400, 'An artifact holds at most 10 MB. Shrink or remove files and publish again.', { param: 'files' })
      if (!totals.hasEntry) throw new HttpError(400, `Keep ${entry}: the artifact opens from it.`, { param: 'remove' })
      return saved
    })
    const [published] = await artifactsOf([row])
    if (threadId) shown.set(`${agentId}:${threadId}`, { at: Date.now(), card: { id: published!.id, title: published!.title, kind: published!.kind, access: published!.access, size: published!.size } })
    return published!
  },

  card({ agentId, threadId, since }: { agentId: string; threadId: string; since: Date }): { type: 'data-artifact'; data: ArtifactCard } | undefined {
    const key = `${agentId}:${threadId}`
    const held = shown.get(key)
    if (!held || Date.now() - held.at > KEPT_MS || held.at < since.getTime()) return undefined
    shown.delete(key)
    return { type: 'data-artifact', data: held.card }
  },

  async read({ agentId, artifact, path }: { agentId: string; artifact: string; path?: string }): Promise<string> {
    const row = await db.selectFrom('artifact').selectAll().where('id', '=', artifact).where('agent_id', '=', agentId).executeTakeFirst()
    if (!row) throw notYours(artifact)
    if (path === undefined) {
      const files = await db.selectFrom('artifact_file').select(['path', 'type', sql<number>`octet_length(body)`.as('size')]).where('artifact_id', '=', artifact).orderBy('path').execute()
      return JSON.stringify({ id: row.id, title: row.title, ver: row.ver, access: row.access, entry: row.entry, files: files.map((file) => ({ ...file, size: Number(file.size) })) })
    }
    const file = await db.selectFrom('artifact_file').select(['type', 'body']).where('artifact_id', '=', artifact).where('path', '=', cleanPath(path)).executeTakeFirst()
    if (!file) throw new HttpError(404, `${artifact} has no file ${path}. Read it without a path to list its files.`, { param: 'path' })
    if (!isText(file.type)) return `${path} is a ${file.type} file of ${file.body.length} bytes. Only text files can be read back.`
    if (file.body.length > READ_BYTES) return `${path} is ${file.body.length} bytes, over the 400 KB you can read back.`
    return Buffer.from(file.body).toString()
  },

  async listForAgent({ agentId }: { agentId: string }): Promise<Artifact[]> {
    return artifactsOf(await db.selectFrom('artifact').selectAll().where('agent_id', '=', agentId).orderBy('updated_at', 'desc').execute())
  },

  async shareAsAgent({ agentId, artifact, ...change }: { agentId: string; artifact: string; access?: ArtifactAccess } & Omit<UpdateArtifact, 'access'>): Promise<Row> {
    const row = await db.selectFrom('artifact').selectAll().where('id', '=', artifact).where('agent_id', '=', agentId).executeTakeFirst()
    if (!row) throw notYours(artifact)
    return changeAccess({ row, ...change })
  },

  async list({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Artifact[]> {
    const rows = await db.selectFrom('artifact').selectAll().where('agent_id', '=', agentId).orderBy('updated_at', 'desc').execute()
    const canUse = await uses({ actor, agentId })
    return artifactsOf(rows.filter((row) => roleOf({ uses: canUse, email: actor.email, access: row.access, people: row.people })))
  },

  async view({ actor, id }: { actor: Caller; id: string }): Promise<ArtifactView> {
    const row = await found(id)
    const role = roleOf({ uses: await uses({ actor, agentId: row.agent_id }), email: actor.email, access: row.access, people: row.people })
    if (!role) throw missing()
    return viewOf({ row, canManage: role === 'manage' })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateArtifact }): Promise<ArtifactView> {
    return viewOf({ row: await changeAccess({ row: await managed({ actor, id }), ...patch }), canManage: true })
  },

  async resetLink({ actor, id }: { actor: Caller; id: string }): Promise<ArtifactView> {
    const row = await managed({ actor, id })
    if (row.access !== 'link') throw new HttpError(400, 'Set access to Anyone with the link first.', { param: 'access' })
    const next = await db.updateTable('artifact').set({ share_token: newShareToken() }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    return viewOf({ row: next, canManage: true })
  },

  async remove({ actor, id }: { actor: Caller; id: string }): Promise<void> {
    await managed({ actor, id })
    await db.deleteFrom('artifact').where('id', '=', id).execute()
  },

  async shared({ token }: { token: string }): Promise<SharedArtifact> {
    const row = await db.selectFrom('artifact').innerJoin('agent', 'agent.id', 'artifact.agent_id').selectAll('artifact').select('agent.name as agentName')
      .where('artifact.share_token', '=', token).where('artifact.access', '=', 'link').executeTakeFirst()
    if (!row) throw missing()
    return { id: row.id, title: row.title, kind: kindOf(row.entry), agentName: row.agentName, src: srcOf(row) }
  },

  async file({ id, sig, path }: { id: string; sig: string; path: string }): Promise<{ type: string; body: Uint8Array; kind: ArtifactKind; name: string }> {
    if (!verify({ id, sig })) throw missing()
    const row = await found(id)
    const wanted = path ? cleanPath(path) : row.entry
    const tried = extname(wanted) ? [wanted] : [wanted, `${wanted}/index.html`, row.entry]
    const files = await db.selectFrom('artifact_file').select(['path', 'type', 'body']).where('artifact_id', '=', id).where('path', 'in', tried).execute()
    const file = tried.map((each) => files.find((one) => one.path === each)).find(Boolean)
    if (!file) throw new HttpError(404, 'That file isn’t in this artifact.')
    return { type: file.type, body: file.body, kind: kindOf(row.entry), name: file.path.split('/').at(-1)! }
  },
}

function newEntry(paths: string[]): string {
  if (paths.includes('index.html')) return 'index.html'
  if (paths.length === 1) return paths[0]!
  throw new HttpError(400, 'A new artifact needs an index.html, or exactly one file.', { param: 'files' })
}
