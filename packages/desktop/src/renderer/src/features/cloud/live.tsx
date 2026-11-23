import { useEffect, useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Cloud, RuntimeInvite } from '@openhut/common/cloud/cloud.ts'
import { PILL } from '@/components/kit'
import { DeviceIcon } from '@/components/custom/device'
import { InToasts, Toast } from '@/components/custom/toast'
import { PersonFace } from '@/components/custom/person-face'
import { Button } from '@/components/ui/button'
import { useUpdateAgent } from '@/features/agents/api'
import { useCloud } from '@/features/cloud/api'
import { useComputers } from '@/features/computers/api'
import { request } from '@/lib/api-client'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const KEPT = 'openhut.kept-there.'
const joining = new Set<string>()

export function OfflineChip({ className }: { className?: string }) {
  const cloud = useCloud().data
  if (cloud?.status !== 'offline') return null
  return <div className={cn('flex shrink-0 items-center gap-1.5 rounded-md bg-soft px-2 py-1 text-[12px] whitespace-nowrap text-body', className)} role="status">
    <span className="size-1.5 rounded-full bg-amber" />Offline · your edits send when you’re back
  </div>
}

export function MoveHere({ agent }: { agent: Agent }) {
  const [kept, setKept] = useState(() => stored(agent.id))
  const update = useUpdateAgent(agent.id)
  if (agent.runsHere || agent.wanted !== 'running' || (kept && !agent.runsNowhere) || !agent.canEdit || !agent.canManage) return null
  const keep = () => {
    remember(agent.id)
    setKept(true)
  }
  return <InToasts><Toast lead={<DeviceIcon kind="mac" />} title={agent.runsNowhere ? `No computer runs ${agent.name} now` : `${agent.name} still runs on ${agent.runsOnName ?? 'your other computer'}`} note={agent.runsNowhere ? 'The computer it ran on left this team.' : 'Only one computer can run an agent.'}>
    <span className="flex shrink-0 flex-col gap-1">
      <Button type="button" variant="primary" className={PILL} disabled={update.isPending} onClick={() => update.mutate({ runsHere: true }, { onError: toastError })}>Run here</Button>
      {!agent.runsNowhere && <Button type="button" variant="text" className="h-auto px-1 text-[12px] text-mute" onClick={keep}>Keep it there</Button>}
    </span>
  </Toast></InToasts>
}

export function ChangedBy({ email }: { email: string }) {
  return <span className="inline-flex items-center gap-1.5"><PersonFace name={email} email={email} size={16} />{firstName(email)} changed this last.</span>
}

export function useChangedByOther(email: string | null): boolean {
  const mine = useCloud().data?.email
  return !!email && email !== mine
}

export function firstName(email: string): string {
  const first = email.split(/[\s@]/)[0] ?? email
  return first.charAt(0).toUpperCase() + first.slice(1)
}

export function useJoinRuntimes() {
  const cloud = useCloud().data
  const computers = useComputers().data
  useEffect(() => {
    if (cloud?.status !== 'on') return
    for (const computer of computers ?? []) {
      if (!computer.url || !computer.online || joining.has(computer.id)) continue
      joining.add(computer.id)
      void join(computer.id).catch(() => joining.delete(computer.id))
    }
  }, [cloud?.status, computers])
}

async function join(computer: string): Promise<void> {
  const remote = await request({ schema: Cloud, computer, path: '/api/cloud' })
  if (remote.status !== 'off' || !remote.device) return
  const invite = await request({ schema: RuntimeInvite, computer: 'local', path: '/api/cloud/runtimes', method: 'POST', body: { device: remote.device } })
  await request({ schema: Cloud, computer, path: '/api/cloud/join', method: 'POST', body: invite })
}

function stored(id: string): boolean {
  try {
    return localStorage.getItem(KEPT + id) === '1'
  } catch {
    return false
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(KEPT + id, '1')
  } catch {
    return
  }
}
