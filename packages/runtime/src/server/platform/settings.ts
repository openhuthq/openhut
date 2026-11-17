import * as z from 'zod/mini'
import { db } from './db.ts'
import { seal, unseal } from './secrets.ts'

const GoogleClient = z.object({ clientId: z.string(), clientSecret: z.string() })
const CodexTokens = z.object({ accessToken: z.string(), refreshToken: z.string() })
const TailscaleJoin = z.object({ by: z.string(), at: z.string(), joined: z.boolean() })
const loaded = await db.selectFrom('install_setting').select(['name', 'value']).execute()
const rows = new Map(loaded.map((row) => [row.name, row.value]))

export const settings = {
  tailnetUrl: (): string | undefined => rows.get('tailnet_url') || undefined,
  setTailnetUrl: (url: string | null) => url ? write('tailnet_url', url) : forget('tailnet_url'),
  seatToken: (): string => {
    const sealed = rows.get('seat_token')
    return sealed ? unseal(sealed) : ''
  },
  setSeatToken: async (token: string) => {
    await write('seat_token', seal(token))
    await write('seat_at', new Date().toISOString())
  },
  seatAt: (): string | null => rows.get('seat_at') ?? null,
  setSeatAt: (at: string) => write('seat_at', at),
  codexTokens: (): CodexTokens | undefined => {
    const sealed = rows.get('codex_tokens')
    return sealed ? z.parse(CodexTokens, JSON.parse(unseal(sealed))) : undefined
  },
  setCodexTokens: async (tokens: CodexTokens) => {
    await write('codex_tokens', seal(JSON.stringify(tokens)))
    await write('codex_at', new Date().toISOString())
  },
  codexAt: (): string | null => rows.get('codex_at') ?? null,
  setCodexAt: (at: string) => write('codex_at', at),
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
  usageData: (): boolean => rows.get('usage_data') !== 'off',
  setUsageData: (on: boolean) => write('usage_data', on ? 'on' : 'off'),
  instanceId: (): string | undefined => rows.get('instance_id') || undefined,
  setInstanceId: async (id: string): Promise<string> => {
    await write('instance_id', id)
    return id
  },
  update: (): string | undefined => rows.get('update') || undefined,
  setUpdate: (record: string) => write('update', record),
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
export type CodexTokens = z.infer<typeof CodexTokens>
export type TailscaleJoin = z.infer<typeof TailscaleJoin>
