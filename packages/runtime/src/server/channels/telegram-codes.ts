import { randomBytes } from 'node:crypto'
import { log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'
import { telegram } from '../integrations/telegram/telegram.ts'

export const CLAIM_MS = 10 * 60_000
export const INVITE_MS = 24 * 60 * 60_000
const START = /^\/start(?:@\w+)?\s+([\w-]{16,64})$/
const codes = new Map<string, Code>()
const claims = new Map<string, { code: string; expires: number; abort: AbortController }>()

export type Person = { userId: string; name: string; chatId: number }

export const telegramCodes = {
  claim({ channelId, agentId, account, botToken, onClaim }: { channelId: string; agentId: string; account: string; botToken: string; onClaim: (person: Person) => Promise<void> }): string {
    const running = claims.get(channelId)
    if (running && running.expires > Date.now()) return telegram.startLink({ account, code: running.code })
    running?.abort.abort()
    const code = newCode({ channelId, agentId, kind: 'claim', ms: CLAIM_MS })
    const claim = { code, expires: Date.now() + CLAIM_MS, abort: new AbortController() }
    claims.set(channelId, claim)
    void poll({ botToken, claim, onClaim }).finally(() => { if (claims.get(channelId) === claim) claims.delete(channelId) })
    return telegram.startLink({ account, code })
  },

  invite({ channelId, agentId, account }: { channelId: string; agentId: string; account: string }): { url: string; expiresAt: string } {
    const code = newCode({ channelId, agentId, kind: 'invite', ms: INVITE_MS })
    return { url: telegram.startLink({ account, code }), expiresAt: new Date(Date.now() + INVITE_MS).toISOString() }
  },

  take({ code, agentId, kind }: { code: string; agentId: string; kind: Code['kind'] }): Code | undefined {
    const found = codes.get(code)
    if (!found || found.agentId !== agentId || found.kind !== kind) return undefined
    codes.delete(code)
    return found.expires > Date.now() ? found : undefined
  },

  stop(channelId: string): void {
    claims.get(channelId)?.abort.abort()
    claims.delete(channelId)
    for (const [code, each] of codes) if (each.channelId === channelId) codes.delete(code)
  },

  codeIn(text: string): string | undefined {
    return START.exec(text.trim())?.[1]
  },
}

async function poll({ botToken, claim, onClaim }: { botToken: string; claim: { code: string; expires: number; abort: AbortController }; onClaim: (person: Person) => Promise<void> }): Promise<void> {
  let offset = 0
  while (!claim.abort.signal.aborted && Date.now() < claim.expires) {
    const updates = await telegram.updates({ botToken, offset, signal: AbortSignal.any([claim.abort.signal, AbortSignal.timeout(35_000)]) }).catch((err: unknown) => {
      if (!claim.abort.signal.aborted) log.warn({ event: 'telegram.claim_poll_failed', error: messageOf(err).replaceAll(botToken, '…') })
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
      if (!message?.from || code !== claim.code) continue
      const taken = codes.get(code)
      if (!taken || taken.kind !== 'claim') continue
      codes.delete(code)
      await telegram.updates({ botToken, offset, signal: AbortSignal.timeout(5_000) }).catch(() => undefined)
      await onClaim({ userId: String(message.from.id), name: message.from.first_name ?? 'there', chatId: message.chat.id })
      return
    }
  }
}

function newCode({ channelId, agentId, kind, ms }: { channelId: string; agentId: string; kind: Code['kind']; ms: number }): string {
  const code = randomBytes(16).toString('base64url')
  codes.set(code, { channelId, agentId, kind, expires: Date.now() + ms })
  return code
}

type Code = { channelId: string; agentId: string; kind: 'claim' | 'invite'; expires: number }
