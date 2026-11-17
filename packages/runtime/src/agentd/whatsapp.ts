import { createInterface } from 'node:readline'
import type { Exec } from './sandbox/sandbox.ts'
import { errorText, isRecord, jsonOrUndefined } from './util.ts'

const PAIR_MS = 5 * 60_000
export const PAIR_COMMAND = ['node', '/opt/data/scripts/whatsapp-bridge/bridge.js', '--pair-only', '--pair-json', '--session', '/opt/data/platforms/whatsapp/session']

export type Pairing = { status: 'starting' | 'qr' | 'linked' | 'error'; qr?: string; phone?: string; error?: string }

export function followPairing({ proc, onExit }: { proc: Exec; onExit: () => void }): Pairing {
  const p: Pairing = { status: 'starting' }
  const timer = setTimeout(() => {
    if (pending(p)) fail(p, 'nobody scanned the code within 5 minutes')
    proc.kill()
  }, PAIR_MS)
  createInterface({ input: proc.stdout }).on('line', (line) => follow(p, line))
  proc.exit.then(
    (code) => {
      clearTimeout(timer)
      if (pending(p)) fail(p, `pairing exited (${code})`)
      onExit()
    },
    (e: unknown) => fail(p, `pairing didn't start: ${errorText(e)}`),
  )
  return p
}

export function pending(p: Pairing | undefined) {
  return p?.status === 'starting' || p?.status === 'qr'
}

function follow(p: Pairing, line: string) {
  const event = jsonOrUndefined(line)
  if (!isRecord(event)) return
  switch (event.event) {
    case 'qr':
      if (typeof event.qr !== 'string') return
      p.status = 'qr'
      p.qr = event.qr
      return
    case 'connected':
      p.status = 'linked'
      p.qr = undefined
      p.phone = phoneOf(event.user)
      return
    case 'error':
      fail(p, String(event.error).slice(0, 200))
  }
}

function fail(p: Pairing, error: string) {
  p.status = 'error'
  p.error = error
}

function phoneOf(user: unknown) {
  const id = isRecord(user) ? String(user.id ?? '') : ''
  return id.split(/[:@]/)[0] || undefined
}
