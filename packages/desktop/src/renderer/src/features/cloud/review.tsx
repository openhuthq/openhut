import { useState } from 'react'
import { FACES, type DeviceRequest } from '@openhut/common/cloud/cloud.ts'
import { Creature } from '@/components/creature'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useApprove, useDeny, useReview } from '@/features/cloud/workspaces'
import { randomLook, SWATCHES, type Look } from '@/lib/face'
import { useConfirmed } from '@/lib/native'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const SHOWN = 8

export function faceLook(index: number): Look {
  return { ...randomLook({ seed: 'openhut-face' }), body: index % SWATCHES.length, eyes: index % 5, mouth: index % 3, hat: null, eyewear: null, extra: null }
}

export function FaceTile({ index, size = 44 }: { index: number; size?: number }) {
  return <Creature look={faceLook(index)} size={size} tile label={`${SWATCHES[index % SWATCHES.length].name} face`} />
}

export function useAnswer({ workspace, request, label }: { workspace: string; request: DeviceRequest; label: string }) {
  const approve = useApprove()
  const deny = useDeny()
  const review = useReview()
  const { asking, confirm } = useConfirmed()
  const name = `review:${request.device}`
  const reviewing = useOpen() === name
  const letIn = (faces?: number[]) => void confirm(`Approve ${label}`).then((ok) => {
    if (ok) approve.mutate({ id: workspace, device: request.device, faces }, { onSuccess: () => { open(); toast(`${label} is unlocking`) }, onError: toastError })
  })
  return {
    busy: approve.isPending || deny.isPending || review.isPending || asking,
    approve: () => request.checked ? review.mutate({ id: workspace, device: request.device }, { onSuccess: () => open(name), onError: toastError }) : letIn(),
    deny: () => deny.mutate({ id: workspace, device: request.device }, { onSuccess: () => toast('Denied'), onError: toastError }),
    notMe: () => deny.mutate({ id: workspace, device: request.device, why: 'not-me' }, { onSuccess: () => { open(); toast('Turned down. That session was signed out.') }, onError: toastError }),
    dialog: reviewing && <MatchFaces label={label} request={request} busy={approve.isPending || asking}
      onMatch={letIn} onMiss={() => deny.mutate({ id: workspace, device: request.device, why: 'mismatch' }, { onSuccess: () => { open(); toast('Turned down. The faces didn’t match.') }, onError: toastError })}
      onNotMe={() => deny.mutate({ id: workspace, device: request.device, why: 'not-me' }, { onSuccess: () => { open(); toast('Turned down. That session was signed out.') }, onError: toastError })} />,
  }
}

function MatchFaces({ label, request, busy, onMatch, onMiss, onNotMe }: { label: string; request: DeviceRequest; busy: boolean; onMatch: (faces: number[]) => void; onMiss: () => void; onNotMe: () => void }) {
  const [decoys] = useState(() => Array.from({ length: FACES }, (_, i) => i).sort(() => Math.random() - .5))
  const [picked, setPicked] = useState<number[]>([])
  const faces = request.faces
  const shown = faces ? [...faces, ...decoys.filter((each) => !faces.includes(each)).slice(0, SHOWN - 2)].sort((a, b) => decoys.indexOf(a) - decoys.indexOf(b)) : []
  const tap = (index: number) => {
    const next = picked.includes(index) ? picked.filter((each) => each !== index) : [...picked, index]
    setPicked(next)
    if (next.length < 2 || !faces) return
    if (next.every((each) => faces.includes(each))) onMatch(next)
    else onMiss()
  }
  return <Dialog size="narrow" label={`Approve ${label}`} onClose={() => open()}>
    <DialogHead title="Tap the two faces on the new computer" subtitle={label} onClose={() => open()} />
    <div className="grid gap-4 px-5 pb-5">
      {faces
        ? <div className="grid grid-cols-4 gap-2">{shown.map((index) => <Button key={index} type="button" variant="bare" aria-pressed={picked.includes(index)} disabled={busy}
            className={cn('grid aspect-square place-items-center rounded-xl border-[1.5px] border-hair bg-white', picked.includes(index) && 'border-ink ring-2 ring-ink/10')} onClick={() => tap(index)}><FaceTile index={index} /></Button>)}</div>
        : <span className="inline-flex items-center gap-2 text-[13px] text-mute"><Spinner className="mt-0 size-3" />Waiting for the new computer to show its faces…</span>}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="text" className="font-normal text-mute" disabled={busy} onClick={onNotMe}>Not on the screen: Not me</Button>
        <Button type="button" variant="secondary" onClick={() => open()}>Cancel</Button>
      </div>
    </div>
  </Dialog>
}
