import * as z from 'zod/mini'
import type { Secret } from '@openhut/common/records/lease.ts'
import { HttpError } from '../../../src/server/platform/http-error.ts'
import { changed, idOf, recordsService, type Held, type PutRecord } from '../../../src/server/cloud/records.ts'

export type FakeRecords = ReturnType<typeof useFakeRecords>
type Write = Omit<PutRecord, 'collection' | 'id' | 'parent'> & { collection: Held['collection']; id: string; parent?: string; deleted?: boolean }

export function useFakeRecords({ by = 'this-device' }: { by?: string } = {}) {
  const rows = new Map<string, Held>()
  const seen = new Map<string, number>()
  const outbox: Write[] = []
  const leases: string[] = []
  let offline = false

  const see = (row: Held): Held => {
    if (row.ver < (seen.get(row.id) ?? 0)) throw new HttpError(502, 'OpenHut Cloud sent an older copy than this computer has seen.')
    seen.set(row.id, row.ver)
    return row
  }
  const store = (row: Held): Held => {
    rows.set(row.id, row)
    changed({ collection: row.collection, id: row.id, ver: row.ver, workspace: row.workspace })
    return row
  }

  async function put({ deleted = false, ...input }: Write): Promise<Held | null> {
    if (offline && input.queue) {
      outbox.push({ ...input, deleted })
      return null
    }
    if (offline) throw new HttpError(502, 'OpenHut Cloud didn’t answer. Check this computer’s internet connection.')
    let patch = { value: input.value, secret: input.secret }
    for (;;) {
      const current = rows.get(input.id)
      if (!current || current.ver === (seen.get(input.id) ?? 0)) {
        const { collection, id, workspace, parent, personal } = input
        return see(store({ collection, id, workspace, parent, ver: (current?.ver ?? 0) + 1, by, value: deleted ? null : patch.value, secret: deleted ? undefined : patch.secret, personal, deleted: deleted || undefined }))
      }
      see(current)
      if (!input.reapply) throw new HttpError(409, 'Someone changed this a moment ago. Try again.')
      const next = await input.reapply(current)
      if (!next) return current
      patch = { value: next.value, secret: next.secret }
    }
  }

  Object.assign(recordsService, {
    list: async ({ collection, workspace, parent }: { collection: Held['collection']; workspace: string; parent?: string }) =>
      [...rows.values()].filter((row) => row.collection === collection && row.workspace === workspace && (parent === undefined || row.parent === parent) && !row.deleted).map(see),
    get: async ({ collection, workspace, id }: { collection: Held['collection']; workspace: string; id: string }) => {
      const row = rows.get(id)
      return row?.collection === collection && row.workspace === workspace ? see(row) : null
    },
    put: (input: PutRecord) => put({ ...input, id: idOf(input) }),
    remove: async ({ collection, workspace, id, queue }: { collection: Held['collection']; workspace: string; id: string; queue?: boolean }) => {
      const current = rows.get(id)
      if (current?.collection === collection && current.workspace === workspace && !current.deleted) await put({ ...current, value: null, queue, deleted: true, reapply: (latest) => latest.deleted ? null : { value: null } })
    },
    lease: async ({ collection, workspace, id, refresh }: { collection: Held['collection']; workspace: string; id: string; refresh: (secret: Secret) => Promise<Secret> }) => {
      if (offline) throw new HttpError(502, 'OpenHut Cloud didn’t answer. Check this computer’s internet connection.')
      const current = rows.get(id)
      if (!current || current.deleted || current.collection !== collection || current.workspace !== workspace) throw new HttpError(404, 'That record doesn’t exist anymore.')
      leases.push(id)
      see(current)
      const secret = await refresh(z.parse(z.record(z.string(), z.unknown()), current.secret))
      return put({ ...current, value: current.value, secret }).then((saved) => saved ?? current)
    },
    held: async (id: string) => seen.get(id) ?? 0,
    drain: async () => undefined,
  })

  return {
    rows,
    outbox,
    leases,

    async offline(on: boolean): Promise<void> {
      offline = on
      if (on) return
      for (const input of outbox.splice(0)) await put({ ...input, queue: false, reapply: (current) => current.deleted ? null : { value: input.value, secret: input.secret } })
    },

    write(row: Omit<Held, 'ver' | 'by'> & { by?: string }): Held {
      return store({ by: 'other-device', ...row, ver: (rows.get(row.id)?.ver ?? 0) + 1 })
    },
  }
}
