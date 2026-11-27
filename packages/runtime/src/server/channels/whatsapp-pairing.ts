import { agent } from '../../core/agent.ts'
import type { Stream } from '../platform/agentd.ts'

const PAIR_MS = 5 * 60_000
const pairings = new Map<string, Following>()

export const whatsappPairing = {
  follow({ agentId, onLinked }: { agentId: string; onLinked: (phone: string | undefined) => Promise<unknown> }): Pairing {
    const known = pairings.get(agentId)
    if (known && (!known.ended || known.pairing.status === 'linked')) return known.pairing
    const following: Following = { pairing: { status: 'starting' }, ended: false, stream: undefined, told: false }
    pairings.set(agentId, following)
    const timer = setTimeout(() => {
      fail(following.pairing, 'nobody scanned the code within 5 minutes')
      following.stream?.close()
    }, PAIR_MS)
    following.stream = agent.attach({
      id: agentId,
      what: 'whatsapp-pairing',
      onLine: (line) => {
        read({ pairing: following.pairing, line })
        if (following.pairing.status === 'linked' && !following.told) {
          following.told = true
          void onLinked(following.pairing.phone).catch(() => { following.told = false })
        }
      },
      onEnd: () => {
        clearTimeout(timer)
        following.ended = true
        if (pending(following.pairing)) fail(following.pairing, 'pairing exited')
      },
    })
    return following.pairing
  },

  stop(agentId: string): void {
    pairings.get(agentId)?.stream?.close()
    pairings.delete(agentId)
  },
}

function read({ pairing, line }: { pairing: Pairing; line: string }): void {
  const event = recordOf(line)
  if (!event) return
  if (event.ok === false) return fail(pairing, String(event.error).slice(0, 200))
  switch (event.event) {
    case 'qr':
      if (typeof event.qr !== 'string') return
      pairing.status = 'qr'
      pairing.qr = event.qr
      return
    case 'connected':
      pairing.status = 'linked'
      pairing.qr = undefined
      pairing.phone = phoneOf(event.user)
      return
    case 'error':
      fail(pairing, String(event.error).slice(0, 200))
  }
}

function pending(pairing: Pairing): boolean {
  return pairing.status === 'starting' || pairing.status === 'qr'
}

function fail(pairing: Pairing, error: string): void {
  if (!pending(pairing)) return
  pairing.status = 'error'
  pairing.error = error
}

function phoneOf(user: unknown): string | undefined {
  const id = isRecord(user) ? String(user.id ?? '') : ''
  return id.split(/[:@]/)[0] || undefined
}

function recordOf(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type Pairing = { status: 'starting' | 'qr' | 'linked' | 'error'; qr?: string; phone?: string; error?: string }
type Following = { pairing: Pairing; ended: boolean; stream: Stream | undefined; told: boolean }
