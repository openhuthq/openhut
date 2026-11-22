import { useState } from 'react'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Hut } from '@/components/hut'
import { useCloud } from '@/features/cloud/api'
import { AllSet, MacIsIn, SaveKit, SignUpIn, Why } from '@/features/cloud/sign-in'
import { Guide, PRIMARY, Step } from '@/features/cloud/step'
import { Unlock } from '@/features/cloud/unlock'
import { HERE } from '@/features/settings/desktop'
import { open } from '@/lib/router'

type Stage = 'why' | 'sign-in' | 'in' | 'kit' | 'done'

export function CloudSetup() {
  const cloud = useCloud().data
  const [stage, setStage] = useState<Stage>(startOf(cloud))
  const [unlocking, setUnlocking] = useState(cloud?.status === 'locked')
  if (!cloud) return null
  if (cloud.status === 'locked' && !unlocking) setUnlocking(true)
  const close = () => open()
  const off = cloud.status === 'off'
  const shown: Stage = off ? (stage === 'why' ? 'why' : 'sign-in') : stage === 'why' || stage === 'sign-in' ? 'in' : stage
  const at = shown === 'in' && unlocking && cloud.status !== 'locked' ? 3 : { why: 0, 'sign-in': 1, in: 2, kit: 3, done: 4 }[shown]
  return <Guide label="OpenHut Cloud" at={at} of={unlocking ? 4 : 5} onClose={close}>
    {shown === 'why' && <Why onNext={() => setStage('sign-in')} />}
    {shown === 'sign-in' && <SignUpIn back={() => setStage('why')} error={cloud.signInError ?? undefined} />}
    {shown === 'in' && cloud.status === 'locked' && <Unlock cloud={cloud} />}
    {shown === 'in' && cloud.status !== 'locked' && (unlocking ? <Unlocked cloud={cloud} onDone={close} /> : <MacIsIn cloud={cloud} onNext={() => cloud.kit ? close() : setStage('kit')} />)}
    {shown === 'kit' && <SaveKit onBack={() => setStage('in')} onDone={() => setStage('done')} />}
    {shown === 'done' && <AllSet onDone={close} />}
  </Guide>
}

function startOf(cloud: Cloud | undefined): Stage {
  if (cloud?.status === 'on' || cloud?.status === 'offline') return cloud.kit ? 'in' : 'kit'
  return cloud?.status === 'locked' ? 'in' : 'why'
}

function Unlocked({ cloud, onDone }: { cloud: Cloud; onDone: () => void }) {
  const { state, done, total, current } = cloud.backup
  const restoring = state === 'restoring'
  return <Step art={<Hut mood={restoring ? 'key' : 'party'} className={restoring ? 'calm key-turn size-[96px]' : 'size-[96px]'} />} title={restoring ? 'Restoring' : `This ${HERE} is in`} line={restoring ? (current ? `${current} · ${Math.min(done + 1, total)} of ${total}` : 'Bringing your agents back…') : 'Your agents are back.'}
    action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onDone}>Done</Button>} />
}

export function KitDialog() {
  const [saved, setSaved] = useState(false)
  return <Guide label="Recovery kit" at={0} of={1} onClose={() => open()}>
    {saved ? <AllSet onDone={() => open()} /> : <SaveKit onDone={() => setSaved(true)} />}
  </Guide>
}
