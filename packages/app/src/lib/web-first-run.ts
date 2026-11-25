import type { Me } from '@openhut/common/cloud/v1/identity.ts'

export const FIRST_RUN_KEY = 'openhut-first-run'
export const HELP = 'https://openhut.dev/docs'

export type FirstRunStep = { step: 'cloud' } | { step: 'server'; code?: string; expiresAt?: string }
export type WebScreen = 'loading' | 'sign-in' | 'first-run' | 'knock' | 'over' | 'offline' | 'connecting' | 'open'

export class Offline extends Error {
  computer: string | null
  seen: number | null
  constructor({ computer, seen }: { computer: string | null; seen: number | null }) {
    super('None of your computers is online. Wake one, then try again.')
    this.computer = computer
    this.seen = seen
  }
}

export type AccountStep = { step: 'first-run' } | { step: 'ready' | 'knock'; workspace: string }

export function accountStepOf(me: Pick<Me, 'home' | 'workspaces'>, invited?: string): AccountStep {
  const listed = (id: string | null | undefined) => me.workspaces.some((each) => each.id === id && each.access === 'listed')
  if (invited && !listed(invited)) return { step: 'knock', workspace: invited }
  const ready = listed(me.home) ? me.home : me.workspaces.find((each) => each.access === 'listed')?.id
  if (ready) return { step: 'ready', workspace: ready }
  const waiting = me.workspaces.find((each) => each.id === me.home) ?? me.workspaces[0]
  return waiting ? { step: 'knock', workspace: waiting.id } : { step: 'first-run' }
}

export function screenOf({ step, opened, error }: { step: string | undefined; opened: boolean; error: unknown }): WebScreen {
  if (opened) return 'open'
  if (step === 'signed-out') return 'sign-in'
  if (step === 'first-run') return 'first-run'
  if (step === 'waiting') return 'knock'
  if (step === 'over') return 'over'
  if (step === 'ready' && error instanceof Offline) return 'offline'
  return step || error ? 'connecting' : 'loading'
}

export function savedOf(raw: string | null): FirstRunStep | null {
  try {
    const saved: unknown = JSON.parse(raw ?? 'null')
    if (typeof saved !== 'object' || !saved || !('step' in saved)) return null
    if (saved.step === 'cloud') return { step: 'cloud' }
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
