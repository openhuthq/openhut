import { db } from './db.ts'
import { config } from './config.ts'
import { seal, unseal } from './secrets.ts'

const loaded = await db.selectFrom('install_setting').select(['name', 'value']).execute()
const rows = new Map(loaded.map((row) => [row.name, row.value]))

export const settings = {
  storedPublicUrl: (): string => rows.get('public_url') ?? '',
  setPublicUrl: (url: string) => write('public_url', url.replace(/\/+$/, '')),
  seatToken: (): string => {
    const sealed = rows.get('seat_token')
    return sealed ? unseal(sealed) : ''
  },
  setSeatToken: (token: string) => write('seat_token', seal(token)),
  appliedBuild: (): string | undefined => rows.get('build'),
  setAppliedBuild: (build: string) => write('build', build),
  update: (): string | undefined => rows.get('update') || undefined,
  setUpdate: (record: string) => write('update', record),
}

export function publicUrl(): string {
  return settings.storedPublicUrl() || `http://localhost:${config.port}`
}

async function write(name: string, value: string): Promise<void> {
  await db.insertInto('install_setting').values({ name, value })
    .onConflict((oc) => oc.column('name').doUpdateSet({ value })).execute()
  rows.set(name, value)
}
