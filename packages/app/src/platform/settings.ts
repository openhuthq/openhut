import * as z from 'zod/mini'
import { db } from './db.ts'
import { config } from './config.ts'
import { seal, unseal } from './secrets.ts'

const GoogleClient = z.object({ clientId: z.string(), clientSecret: z.string() })
const TailscaleJoin = z.object({ by: z.string(), at: z.string(), joined: z.boolean() })
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
  googleClient: (): GoogleClient | undefined => {
    const sealed = rows.get('google_client')
    return sealed ? z.parse(GoogleClient, JSON.parse(unseal(sealed))) : undefined
  },
  setGoogleClient: (client: GoogleClient) => write('google_client', seal(JSON.stringify(client))),
  tailscale: (): TailscaleJoin | undefined => {
    const stored = rows.get('tailscale')
    return stored ? z.parse(TailscaleJoin, JSON.parse(stored)) : undefined
  },
  setTailscale: (join: TailscaleJoin | undefined) => join ? write('tailscale', JSON.stringify(join)) : forget('tailscale'),
  appliedBuild: (): string | undefined => rows.get('build'),
  setAppliedBuild: (build: string) => write('build', build),
  instanceId: (): string | undefined => rows.get('instance_id') || undefined,
  setInstanceId: async (id: string): Promise<string> => {
    await write('instance_id', id)
    return id
  },
  update: (): string | undefined => rows.get('update') || undefined,
  setUpdate: (record: string) => write('update', record),
}

export function publicUrl(): string {
  return settings.storedPublicUrl() || `http://localhost:${config.port}`
}

async function forget(name: string): Promise<void> {
  await db.deleteFrom('install_setting').where('name', '=', name).execute()
  rows.delete(name)
}

async function write(name: string, value: string): Promise<void> {
  await db.insertInto('install_setting').values({ name, value })
    .onConflict((oc) => oc.column('name').doUpdateSet({ value })).execute()
  rows.set(name, value)
}

export type GoogleClient = z.infer<typeof GoogleClient>
export type TailscaleJoin = z.infer<typeof TailscaleJoin>
