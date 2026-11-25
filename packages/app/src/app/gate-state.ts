import type { Cloud } from '@openhut/common/cloud/cloud.ts'

export type GateStep = 'loading' | 'sign-in' | 'ready'

export function gateOf(cloud: Pick<Cloud, 'status'> | undefined): GateStep {
  if (!cloud) return 'loading'
  return cloud.status === 'off' ? 'sign-in' : 'ready'
}
