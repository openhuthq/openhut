import * as z from 'zod/mini'
import { ProviderModel } from '@openhut/common/models/provider.ts'
import { db } from './db.ts'
import { seal, unseal } from './secrets.ts'

const CodexTokens = z.object({ accessToken: z.string(), refreshToken: z.string() })
const StoredCatalog = z.object({ at: z.string(), models: z.array(ProviderModel) })
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
  forgetSeat: async () => {
    await forget('seat_token')
    await forget('seat_at')
  },
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
  forgetCodex: async () => {
    await forget('codex_tokens')
    await forget('codex_at')
  },
  providerKey: (provider: string): string => {
    const sealed = rows.get(`provider_key_${provider}`)
    return sealed ? unseal(sealed) : ''
  },
  setProviderKey: (provider: string, key: string) => write(`provider_key_${provider}`, seal(key)),
  forgetProviderKey: (provider: string) => forget(`provider_key_${provider}`),
  catalog: (provider: string): StoredCatalog | undefined => {
    const stored = rows.get(`provider_models_${provider}`)
    const parsed = z.safeParse(StoredCatalog, stored ? JSON.parse(stored) : undefined)
    return parsed.success ? parsed.data : undefined
  },
  setCatalog: (provider: string, catalog: StoredCatalog) => write(`provider_models_${provider}`, JSON.stringify(catalog)),
  forgetCatalog: (provider: string) => forget(`provider_models_${provider}`),
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

export type CodexTokens = z.infer<typeof CodexTokens>
export type StoredCatalog = z.infer<typeof StoredCatalog>
