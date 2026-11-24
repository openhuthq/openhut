import { useState } from 'react'
import { FACES, faceName, type DeviceRequest } from '@openhut/common/cloud/cloud.ts'
import { Creature } from '@/components/creature'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useApprove, useDeny, useReview } from '@/features/cloud/workspaces'
import { faceLook } from '@/lib/face'
import { useConfirmed } from '@/lib/native'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const SHOWN = 8

export function FaceTile({ index, size = 64 }: { index: number; size?: number }) {
  return <Creature look={faceLook(index)} size={size} label={faceName(index)} />
}

export function useAnswer({ workspace, request, label }: { workspace: string; request: DeviceRequest; label: string }) {
  const approve = useApprove()
  const deny = useDeny()
  const review = useReview()
  const { asking, confirm } = useConfirmed()
  const name = `review:${request.device}`
  const reviewing = useOpen() === name
  const letIn = (faces?: number[]) => void confirm(`Approve ${label}`).then((ok) => {
    if (ok) approve.mutate({ id: workspace, device: request.device, faces }, { onSuccess: () => { open(); toast(request.server ? `${label} is joining. Its agents can run there in a moment.` : `${label} is unlocking`) }, onError: toastError })
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
  const server = request.server
  return <Dialog size="narrow" label={`Approve ${label}`} onClose={() => open()}>
    <DialogHead title={server ? 'Tap the two faces the server printed' : 'Tap the two faces on the new computer'} subtitle={server ? `${label} printed them where you ran the install command` : label} onClose={() => open()} />
    <div className="grid gap-4 px-5 pb-5">
      {faces
        ? <div className="grid grid-cols-4 gap-2">{shown.map((index) => <Button key={index} type="button" variant="bare" aria-pressed={picked.includes(index)} disabled={busy}
            className={cn('grid place-items-center gap-1 rounded-xl border-[1.5px] border-hair bg-white px-1 py-2', picked.includes(index) && 'border-ink ring-2 ring-ink/10')} onClick={() => tap(index)}>
              <FaceTile index={index} />
              <span className="text-center text-[11px]/[13px] text-mute">{faceName(index)}</span>
            </Button>)}</div>
        : <span className="inline-flex items-center gap-2 text-[13px] text-mute"><Spinner className="mt-0 size-3" />{server ? 'Waiting for the server to print its faces…' : 'Waiting for the new computer to show its faces…'}</span>}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="text" className="font-normal text-mute" disabled={busy} onClick={onNotMe}>{server ? 'Not printed there · Deny' : 'Not on its screen · Deny'}</Button>
        <Button type="button" variant="secondary" onClick={() => open()}>Cancel</Button>
      </div>
    </div>
  </Dialog>
}
