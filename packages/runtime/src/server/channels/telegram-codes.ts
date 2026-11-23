import { randomBytes } from 'node:crypto'
import { db } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'
import { seal, sha, unseal } from '../platform/secrets.ts'
import { telegram } from '../integrations/telegram/telegram.ts'

export const CLAIM_MS = 10 * 60_000
export const INVITE_MS = 24 * 60 * 60_000
const START = /^\/start(?:@\w+)?\s+([\w-]{16,64})$/
const polling = new Map<string, AbortController>()

export type Person = { userId: string; name: string; chatId: number }
type Kind = 'claim' | 'invite'
type Claim = { channelId: string; agentId: string; account: string; botToken: string; onClaim: (person: Person) => Promise<void> }

export const telegramCodes = {
  async claim(claim: Claim): Promise<string> {
    const code = await current(claim.channelId) ?? await issue({ channelId: claim.channelId, agentId: claim.agentId, kind: 'claim', ms: CLAIM_MS })
    if (!polling.has(claim.channelId)) watch(claim)
    return telegram.startLink({ account: claim.account, code })
  },

  async invite({ channelId, agentId, account }: { channelId: string; agentId: string; account: string }): Promise<{ url: string; expiresAt: string }> {
    const code = await issue({ channelId, agentId, kind: 'invite', ms: INVITE_MS })
    return { url: telegram.startLink({ account, code }), expiresAt: new Date(Date.now() + INVITE_MS).toISOString() }
  },

  async take({ code, agentId, kind }: { code: string; agentId: string; kind: Kind }): Promise<{ channelId: string } | undefined> {
    const row = await db.deleteFrom('telegram_code').where('hash', '=', sha(code)).where('agent_id', '=', agentId).where('kind', '=', kind).returning(['channel_id', 'expires_at']).executeTakeFirst()
    return row && new Date(row.expires_at).getTime() > Date.now() ? { channelId: row.channel_id } : undefined
  },

  async settle(channelId: string): Promise<void> {
    polling.get(channelId)?.abort()
    polling.delete(channelId)
    await db.deleteFrom('telegram_code').where('channel_id', '=', channelId).where('kind', '=', 'claim').execute()
  },

  async stop(channelId: string): Promise<void> {
    polling.get(channelId)?.abort()
    polling.delete(channelId)
    await db.deleteFrom('telegram_code').where('channel_id', '=', channelId).execute()
  },

  async pending(): Promise<string[]> {
    const rows = await db.selectFrom('telegram_code').select('channel_id').where('kind', '=', 'claim').where('expires_at', '>', new Date()).execute()
    return rows.map((row) => row.channel_id)
  },

  codeIn(text: string): string | undefined {
    return START.exec(text.trim())?.[1]
  },
}

async function current(channelId: string): Promise<string | undefined> {
  const row = await db.selectFrom('telegram_code').select('sealed').where('channel_id', '=', channelId).where('kind', '=', 'claim').where('expires_at', '>', new Date()).executeTakeFirst()
  return row?.sealed ? unseal(row.sealed) : undefined
}

async function issue({ channelId, agentId, kind, ms }: { channelId: string; agentId: string; kind: Kind; ms: number }): Promise<string> {
  await db.deleteFrom('telegram_code').where('expires_at', '<', new Date()).execute()
  if (kind === 'claim') await db.deleteFrom('telegram_code').where('channel_id', '=', channelId).where('kind', '=', 'claim').execute()
  const code = randomBytes(16).toString('base64url')
  await db.insertInto('telegram_code').values({ hash: sha(code), channel_id: channelId, agent_id: agentId, kind, sealed: kind === 'claim' ? seal(code) : null, expires_at: new Date(Date.now() + ms) }).execute()
  return code
}

function watch(claim: Claim): void {
  const abort = new AbortController()
  polling.set(claim.channelId, abort)
  void poll({ claim, signal: abort.signal })
    .catch((err: unknown) => log.warn({ event: 'telegram.claim_failed', channel: claim.channelId, error: messageOf(err).replaceAll(claim.botToken, '…') }))
    .finally(() => { if (polling.get(claim.channelId) === abort) polling.delete(claim.channelId) })
}

async function poll({ claim, signal }: { claim: Claim; signal: AbortSignal }): Promise<void> {
  let offset = 0
  while (!signal.aborted && await current(claim.channelId)) {
    const updates = await telegram.updates({ botToken: claim.botToken, offset, signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]) }).catch((err: unknown) => {
      if (!signal.aborted) log.warn({ event: 'telegram.claim_poll_failed', channel: claim.channelId, error: messageOf(err).replaceAll(claim.botToken, '…') })
      return null
    })
    if (!updates) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      continue
    }
    for (const update of updates) {
      offset = update.update_id + 1
      const message = update.message
      const code = message?.text ? telegramCodes.codeIn(message.text) : undefined
      if (!message?.from || !code || !await telegramCodes.take({ code, agentId: claim.agentId, kind: 'claim' })) continue
      await telegram.updates({ botToken: claim.botToken, offset, signal: AbortSignal.timeout(5_000) }).catch(() => undefined)
      await claim.onClaim({ userId: String(message.from.id), name: message.from.first_name ?? 'there', chatId: message.chat.id })
      return
    }
  }
}
