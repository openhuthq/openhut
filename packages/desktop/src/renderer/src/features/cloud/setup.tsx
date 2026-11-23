import { useState } from 'react'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Hut } from '@/components/hut'
import { useCloud } from '@/features/cloud/api'
import { AllSet, MacIsIn, SaveKit } from '@/features/cloud/sign-in'
import { Guide, PRIMARY, Step } from '@/features/cloud/step'
import { Unlock } from '@/features/cloud/unlock'
import { open } from '@/lib/router'

type Stage = 'in' | 'kit' | 'done'

export function CloudSetup() {
  const cloud = useCloud().data
  const [stage, setStage] = useState<Stage>(startOf(cloud))
  const [unlocking, setUnlocking] = useState(cloud?.status === 'locked')
  if (!cloud || cloud.status === 'off') return null
  if (cloud.status === 'locked' && !unlocking) setUnlocking(true)
  const close = () => open()
  const shown = stage
  const at = shown === 'in' && unlocking && cloud.status !== 'locked' ? 1 : { in: 0, kit: 1, done: 2 }[shown]
  return <Guide label="OpenHut Cloud" at={at} of={unlocking ? 2 : 3} onClose={close}>
    {shown === 'in' && cloud.status === 'locked' && <Unlock cloud={cloud} />}
    {shown === 'in' && cloud.status !== 'locked' && (unlocking ? <Unlocked cloud={cloud} onDone={close} /> : <MacIsIn cloud={cloud} onNext={() => cloud.kit ? close() : setStage('kit')} />)}
    {shown === 'kit' && <SaveKit onBack={() => setStage('in')} onDone={() => setStage('done')} />}
    {shown === 'done' && <AllSet onDone={close} />}
  </Guide>
}

function startOf(cloud: Cloud | undefined): Stage {
  if (cloud?.status === 'on' || cloud?.status === 'offline') return cloud.kit ? 'in' : 'kit'
  return 'in'
}

function Unlocked({ cloud, onDone }: { cloud: Cloud; onDone: () => void }) {
  const { state, done, total, current } = cloud.backup
  const restoring = state === 'restoring'
  return <Step art={<Hut mood={restoring ? 'key' : 'party'} className={restoring ? 'calm key-turn size-[96px]' : 'size-[96px]'} />} title={restoring ? 'Restoring' : 'This computer is unlocked'} line={restoring ? (current ? `${current} · ${Math.min(done + 1, total)} of ${total}` : 'Restoring your agents…') : 'Your agents and chats are restored.'}
    action={<Button type="button" variant="primary" className={PRIMARY} autoFocus onClick={onDone}>Done</Button>} />
}

export function KitDialog() {
  const [saved, setSaved] = useState(false)
  return <Guide label="Recovery kit" at={0} of={1} onClose={() => open()}>
    {saved ? <AllSet onDone={() => open()} /> : <SaveKit onDone={() => setSaved(true)} />}
  </Guide>
}
