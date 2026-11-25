import type { Me } from '@openhut/common/cloud/v1/identity.ts'

export const HELP = 'https://openhut.dev/docs'

export type WebScreen = 'loading' | 'sign-in' | 'knock' | 'over' | 'offline' | 'connecting' | 'open'

export class Offline extends Error {
  computer: string | null
  seen: number | null
  constructor({ computer, seen }: { computer: string | null; seen: number | null }) {
    super('None of your computers is online. Wake one, then try again.')
    this.computer = computer
    this.seen = seen
  }
}

export type AccountStep = { step: 'first-run'; workspace: string } | { step: 'ready' | 'knock' | 'invited'; workspace: string }

export function accountStepOf(me: Pick<Me, 'home' | 'workspaces' | 'unstarted'>, { invited, chosen }: { invited?: string; chosen?: string | null } = {}): AccountStep {
  const listed = (id: string | null | undefined) => me.workspaces.some((each) => each.id === id && each.access === 'listed')
  if (invited && !listed(invited)) return { step: 'invited', workspace: invited }
  if (chosen && listed(chosen)) return { step: 'ready', workspace: chosen }
  if (chosen && me.unstarted.some((each) => each.id === chosen)) return { step: 'first-run', workspace: chosen }
  if (chosen && me.workspaces.some((each) => each.id === chosen)) return { step: 'knock', workspace: chosen }
  const ready = listed(me.home) ? me.home : me.workspaces.find((each) => each.access === 'listed')?.id
  if (ready) return { step: 'ready', workspace: ready }
  const waiting = me.workspaces.find((each) => each.id === me.home) ?? me.workspaces[0]
  return waiting ? { step: 'knock', workspace: waiting.id } : { step: 'first-run', workspace: me.home ?? '' }
}

export function screenOf({ step, opened, error }: { step: string | undefined; opened: boolean; error: unknown }): WebScreen {
  if (opened || step === 'first-run') return 'open'
  if (step === 'signed-out') return 'sign-in'
  if (step === 'waiting' || step === 'invited') return 'knock'
  if (step === 'over') return 'over'
  if (step === 'ready' && error instanceof Offline) return 'offline'
  return step || error ? 'connecting' : 'loading'
}

export function lastSeenOf(reason: string | undefined): number | null {
  const at = Number(/^offline (\d+)$/.exec(reason ?? '')?.[1] ?? 0)
  return at > 0 ? at : null
}
