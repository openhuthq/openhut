import * as z from 'zod/mini'

const AppConfig = z.object({
  cloud: z.string(),
  local: z.optional(z.boolean()),
  dev: z.optional(z.string()),
  updates: z.optional(z.object({ url: z.string(), key: z.string() })),
})
export type AppConfig = z.infer<typeof AppConfig>

export const CLOUD = 'https://cloud.openhut.dev/api'

export async function loadConfig(read: () => Promise<unknown>): Promise<AppConfig> {
  const parsed = AppConfig.safeParse(await read().catch(() => null))
  return parsed.success ? parsed.data : { cloud: CLOUD }
}

export const config: AppConfig = typeof location === 'undefined' ? { cloud: CLOUD } : await loadConfig(() => fetch('/config.json', { cache: 'no-store' }).then((res) => res.json()))
