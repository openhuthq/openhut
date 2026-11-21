import { createHash } from 'node:crypto'
import { db } from '../platform/db.ts'

export const DELETED = 'deleted'
export const DROPPED = 'dropped'
export const SEQ = 'cloud_seq'

export type Row = { id: string; kind: string; ref: string; ver: number; seq: number; hash: string; signer: string | null; agent_id: string | null }
type Place = { ws: string; home: boolean }

export async function rowsById(s: Place): Promise<Map<string, Row>> {
  const rows = await db.selectFrom('cloud_record').select(['id', 'kind', 'ref', 'ver', 'seq', 'hash', 'signer', 'agent_id']).where('workspace', '=', rowKey(s)).execute()
  return new Map(rows.map((row) => [row.id, row]))
}

export async function saveRow(s: Place, row: Row): Promise<void> {
  const values = { ...row, workspace: rowKey(s) }
  await db.insertInto('cloud_record').values(values).onConflict((oc) => oc.column('id').doUpdateSet(values)).execute()
}

export async function droppedSince({ s, agents }: { s: Place; agents?: string[] }): Promise<number | null> {
  if (agents?.length === 0) return null
  let query = db.selectFrom('cloud_record').select((eb) => eb.fn.min('seq').as('seq')).where('workspace', '=', rowKey(s)).where('hash', '=', DROPPED).where('seq', '>', 0)
  if (agents) query = query.where('agent_id', 'in', agents).where('kind', '!=', 'file')
  const seq = (await query.executeTakeFirst())?.seq
  return seq ? Number(seq) - 1 : null
}

export function rowKey(s: Place): string {
  return s.home ? '' : s.ws
}

export function seqName(s: Place): string {
  return s.home ? SEQ : `${SEQ}:${s.ws}`
}

export async function seqOf(s: Place): Promise<number> {
  return Number((await db.selectFrom('install_setting').select('value').where('name', '=', seqName(s)).executeTakeFirst())?.value ?? 0)
}

export function hashItem(item: { value: unknown; owner?: string }): string {
  return item.owner && item.value !== null ? fingerprint([item.owner, item.value]) : fingerprint(item.value)
}

function fingerprint(value: unknown): string {
  return value === null ? DELETED : createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}
