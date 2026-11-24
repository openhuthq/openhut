import type { Me } from '@openhut/common/cloud/v1/identity.ts'

export const FIRST_RUN_KEY = 'openhut-first-run'
export const DOWNLOAD_MAC = 'https://openhut.dev/download/mac?from=web'
export const HELP = 'https://openhut.dev/docs'

export type FirstRunStep = { step: 'mac' } | { step: 'server'; code?: string; expiresAt?: string }
export type WebScreen = 'loading' | 'sign-in' | 'first-run' | 'phone' | 'knock' | 'over' | 'offline' | 'connecting' | 'open'

export class Offline extends Error {
  computer: string | null
  seen: number | null
  constructor({ computer, seen }: { computer: string | null; seen: number | null }) {
    super('None of your computers is online. Open OpenHut on your Mac, then try again.')
    this.computer = computer
    this.seen = seen
  }
}

export function accountStepOf(me: Pick<Me, 'home' | 'workspaces'>): 'first-run' | 'ready' | 'knock' {
  if (!me.workspaces.length) return 'first-run'
  return me.workspaces.find((each) => each.id === me.home)?.access === 'listed' ? 'ready' : 'knock'
}

export function screenOf({ step, opened, error, phone }: { step: string | undefined; opened: boolean; error: unknown; phone: boolean }): WebScreen {
  if (opened) return 'open'
  if (step === 'signed-out') return 'sign-in'
  if (step === 'first-run') return phone ? 'phone' : 'first-run'
  if (step === 'waiting') return 'knock'
  if (step === 'over') return 'over'
  if (step === 'ready' && error instanceof Offline) return 'offline'
  return step || error ? 'connecting' : 'loading'
}

export function savedOf(raw: string | null): FirstRunStep | null {
  try {
    const saved: unknown = JSON.parse(raw ?? 'null')
    if (typeof saved !== 'object' || !saved || !('step' in saved)) return null
    if (saved.step === 'mac') return { step: 'mac' }
    if (saved.step !== 'server') return null
    const code = 'code' in saved && typeof saved.code === 'string' ? saved.code : undefined
    const expiresAt = 'expiresAt' in saved && typeof saved.expiresAt === 'string' ? saved.expiresAt : undefined
    return { step: 'server', ...code && expiresAt && { code, expiresAt } }
  } catch {
    return null
  }
}

export function lastSeenOf(reason: string | undefined): number | null {
  const at = Number(/^offline (\d+)$/.exec(reason ?? '')?.[1] ?? 0)
  return at > 0 ? at : null
}

export function phoneBrowser({ userAgent, width }: { userAgent: string; width: number }): boolean {
  return /iPhone|iPod|Android.*Mobile|Mobile.*Firefox/.test(userAgent) || (/Android|iPad/.test(userAgent) && width < 600)
}
