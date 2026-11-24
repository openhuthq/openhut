import { faceName, type DeviceRequest } from '@openhut/common/cloud/cloud.ts'
import { Creature } from '@/components/creature'
import { PickPair } from '@/features/cloud/knock'
import { useApprove, useDeny, useReview } from '@/features/cloud/workspaces'
import { RequestError } from '@/lib/api-client'
import { faceLook } from '@/lib/face'
import { open, useOpen } from '@/lib/router'
import { toast, toastError, toastInfo } from '@/lib/toast'

export function FaceTile({ index, size = 64 }: { index: number; size?: number }) {
  return <Creature look={faceLook(index)} size={size} label={faceName(index)} />
}

export function useAnswer({ workspace, request, label }: { workspace: string; request: DeviceRequest; label: string }) {
  const approve = useApprove()
  const deny = useDeny()
  const review = useReview()
  const name = `review:${request.device}`
  const reviewing = useOpen() === name
  const letIn = (faces: number[]) => approve.mutate({ id: workspace, device: request.device, faces }, {
    onSuccess: () => { open(); toastInfo(request.server ? `${label} is joining` : `${label} is unlocking`) },
    onError: (error) => {
      if (!(error instanceof RequestError && error.param === 'faces')) return toastError(error)
      open()
      toastInfo('Request turned down', 'The faces didn’t match its screen.')
    },
  })
  const notMe = () => deny.mutate({ id: workspace, device: request.device, why: 'not-me' }, { onSuccess: () => { open(); toast('Session signed out') }, onError: toastError })
  return {
    busy: approve.isPending || deny.isPending || review.isPending,
    approve: () => review.mutate({ id: workspace, device: request.device }, { onSuccess: () => open(name), onError: toastError }),
    deny: () => deny.mutate({ id: workspace, device: request.device }, { onSuccess: () => toast('Request turned down'), onError: toastError }),
    notMe,
    dialog: reviewing && <PickPair label={label} request={request} busy={approve.isPending || deny.isPending} onPick={letIn} onNotMe={notMe} onClose={() => open()} />,
  }
}
