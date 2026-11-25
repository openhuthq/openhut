import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { ProviderModel } from '@openhut/common/models/provider.ts'
import { db } from './db.ts'
import { emit } from './events.ts'
import { seal, unseal } from './secrets.ts'

const GoogleClient = z.object({ id: z.string(), secret: z.string() })
const Smtp = z.object({ host: z.string(), port: z.number(), user: z.string(), password: z.string(), from: z.string() })
const CodexTokens = z.object({ accessToken: z.string(), refreshToken: z.string() })
const StoredCatalog = z.object({ at: z.string(), models: z.array(ProviderModel) })
const loaded = await db.selectFrom('install_setting').select(['name', 'value']).execute()
const rows = new Map(loaded.map((row) => [row.name, row.value]))

export const settings = {
  seatToken: (): string => {
    const sealed = rows.get('seat_token')
    return sealed ? unseal(sealed) : ''
  },
  setSeatToken: async (token: string) => {
    await write('seat_token', seal(token))
    await write('seat_at', new Date().toISOString())
  },
  seatAt: (): string | null => rows.get('seat_at') ?? null,
  formerDevices: (): string[] => z.safeParse(z.array(z.string()), JSON.parse(rows.get('former_devices') ?? '[]')).data ?? [],
  setFormerDevices: (devices: string[]) => write('former_devices', JSON.stringify(devices.slice(-20))),
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
  providerKey: (provider: string): string => {
    const sealed = rows.get(`provider_key_${provider}`)
    return sealed ? unseal(sealed) : ''
  },
  setProviderKey: (provider: string, key: string) => write(`provider_key_${provider}`, seal(key)),
  providerBaseUrl: (provider: string): string => rows.get(`provider_base_${provider}`) ?? '',
  setProviderBaseUrl: (provider: string, url: string) => write(`provider_base_${provider}`, url),
  catalog: (provider: string): StoredCatalog | undefined => {
    const stored = rows.get(`provider_models_${provider}`)
    const parsed = z.safeParse(StoredCatalog, stored ? JSON.parse(stored) : undefined)
    return parsed.success ? parsed.data : undefined
  },
  setCatalog: (provider: string, catalog: StoredCatalog) => write(`provider_models_${provider}`, JSON.stringify(catalog)),
  forgetProvider: async (provider: string) => {
    const secret: Record<string, string[]> = { claude: ['seat_token', 'seat_at'], codex: ['codex_tokens', 'codex_at'] }
    for (const name of [...secret[provider] ?? [`provider_key_${provider}`], `provider_models_${provider}`]) await forget(name)
  },
  appliedBuild: (): string | undefined => rows.get('build'),
  setAppliedBuild: (build: string) => write('build', build),
  update: (): string | undefined => rows.get('update') || undefined,
  setUpdate: (record: string) => write('update', record),
  timeZone: (): string => rows.get('time_zone') || Intl.DateTimeFormat().resolvedOptions().timeZone,
  setTimeZone: (zone: string) => write('time_zone', zone),
  access: (): string | undefined => rows.get('access'),
  signIns: (): Record<string, number> => z.safeParse(z.record(z.string(), z.number()), JSON.parse(rows.get('sign_ins') ?? '{}')).data ?? {},
  setSignIns: (pending: Record<string, number>) => write('sign_ins', JSON.stringify(pending)),
  googleClient: (): GoogleClient | undefined => {
    const sealed = rows.get('google_client')
    return sealed ? z.parse(GoogleClient, JSON.parse(unseal(sealed))) : undefined
  },
  setGoogleClient: (client: GoogleClient) => write('google_client', seal(JSON.stringify(client))),
  googleSignIn: (): boolean => rows.get('google_sign_in') === 'on' && !!rows.get('google_client'),
  setGoogleSignIn: (on: boolean) => write('google_sign_in', on ? 'on' : 'off'),
  smtp: (): Smtp | undefined => {
    const sealed = rows.get('smtp')
    return sealed ? z.parse(Smtp, JSON.parse(unseal(sealed))) : undefined
  },
  setSmtp: (smtp: Smtp) => write('smtp', seal(JSON.stringify(smtp))),
  address: (): string | undefined => rows.get('address'),
  setAddress: (origin: string) => write('address', origin),
  usageData: (): boolean => rows.get('usage_data') === 'on',
  setUsageData: (on: boolean) => write('usage_data', on ? 'on' : 'off'),
  async installId(): Promise<string> {
    if (!rows.get('install_id')) await write('install_id', randomUUID())
    return rows.get('install_id') ?? ''
  },
}

async function forget(name: string): Promise<void> {
  await db.deleteFrom('install_setting').where('name', '=', name).execute()
  rows.delete(name)
  emit({ name: 'setting.updated', target: { type: 'setting', id: name } })
}

async function write(name: string, value: string): Promise<void> {
  await db.insertInto('install_setting').values({ name, value })
    .onConflict((oc) => oc.column('name').doUpdateSet({ value })).execute()
  rows.set(name, value)
  emit({ name: 'setting.updated', target: { type: 'setting', id: name } })
}

export type GoogleClient = z.infer<typeof GoogleClient>
export type Smtp = z.infer<typeof Smtp>
export type CodexTokens = z.infer<typeof CodexTokens>
export type StoredCatalog = z.infer<typeof StoredCatalog>
