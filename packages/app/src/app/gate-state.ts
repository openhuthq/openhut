import type { Cloud } from '@openhut/common/cloud/cloud.ts'

export type GateStep = 'loading' | 'sign-in' | 'unlock' | 'kit' | 'getting-ready' | 'ready'

type Setup = { fresh: boolean; done: boolean; failed: boolean }

export function gateOf({ cloud, encryption, setup, down }: { cloud: Pick<Cloud, 'status' | 'kit' | 'kitInCloud' | 'youngUntil'> | undefined; encryption: boolean; setup: Setup | undefined; down: boolean }): GateStep {
  const settingUp = Boolean(setup?.fresh && !setup.done)
  if (!cloud) return settingUp ? (down || setup?.failed ? 'getting-ready' : 'sign-in') : 'loading'
  if (cloud.status === 'off') return 'sign-in'
  if (cloud.status === 'locked') return 'unlock'
  // With End-to-end encryption off we hold a backup key, so first run asks for no kit; W2's setup asks for it.
  if (encryption && !cloud.kit && !cloud.kitInCloud && !cloud.youngUntil) return 'kit'
  return settingUp ? 'getting-ready' : 'ready'
}

export function migrating({ agents, invited }: { agents: number; invited: boolean }): string | undefined {
  if (!agents || invited) return undefined
  return `Your ${agents === 1 ? 'agent comes' : `${agents} agents come`} with you, end-to-end encrypted.`
}

export type KitWay = 'file' | 'copy' | 'words'

export function checksKit(way: KitWay): boolean {
  return way === 'words'
}
