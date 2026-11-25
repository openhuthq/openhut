import type { Me } from '@openhut/common/cloud/v1/identity.ts'

export const HELP = 'https://openhut.dev/docs'

export type WebScreen = 'loading' | 'sign-in' | 'start-cloud' | 'knock' | 'over' | 'offline' | 'connecting' | 'open'

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
  if (step === 'first-run') return 'start-cloud'
  if (step === 'waiting') return 'knock'
  if (step === 'over') return 'over'
  if (step === 'ready' && error instanceof Offline) return 'offline'
  return step || error ? 'connecting' : 'loading'
}

export function lastSeenOf(reason: string | undefined): number | null {
  const at = Number(/^offline (\d+)$/.exec(reason ?? '')?.[1] ?? 0)
  return at > 0 ? at : null
}
