import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusSignIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { Agent } from '@openhut/common/agents/agent.ts'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Choice, I, MenuCard, ROW, ROW_VALUE } from '@/components/kit'
import { DEVICE_HUE, DEVICE_ICONS } from '@/components/custom/device'
import { nameOf, useComputers } from '@/features/computers/api'
import { noteOf } from '@/features/settings/computers'
import { request } from '@/lib/api-client'
import type { OpenHutAgent } from '@/lib/openhut'
import { AGENTS_KEY, COMPUTERS_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

export function RunsOnRow({ agent }: { agent: Agent }) {
  const computers = useComputers().data
  const move = useMoveAgent(agent.id)
  const [line, setLine] = useState('')
  const from = agent.runsOn ?? 'here'
  const here = computers?.find((computer) => computer.id === from)
  const going = move.isPending ? nameOf({ computers, id: move.variables }) : undefined
  const go = (to: string) => {
    setLine('')
    move.mutate(to, { onError: (error) => setLine(error.message) })
  }
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(ROW, 'h-auto min-h-8 py-1.5 whitespace-normal')} disabled={!!going || !agent.canManage}>
        <I icon={DEVICE_ICONS.server} size={15} className="shrink-0 text-mute" /><span className="shrink-0">Runs on</span>
        <span className={ROW_VALUE}>{going
          ? <><Spinner className="mt-0" /><span className="truncate">Moving to {going}…</span></>
          : <>{here && !here.online && <i className="size-1.5 rounded-full bg-mute-2" />}<span className="text-right [overflow-wrap:anywhere]">{nameOf({ computers, id: from })}{here && !here.online && ' · Offline'}</span></>}
          <I icon={UnfoldMoreIcon} size={12} className="text-mute" /></span>
      </DropdownMenuTrigger>
      <MenuCard title="Runs on">
        {(computers ?? []).map((computer) => <Choice key={computer.id} icon={<I icon={DEVICE_ICONS.server} size={15} className={DEVICE_HUE} />} name={computer.id === from ? computer.name : `Move to ${computer.name}`}
          note={noteOf(computer)} selected={computer.id === from} disabled={computer.id === from || !computer.online} onClick={() => go(computer.id)} />)}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-8 gap-2 text-[13px]" onClick={() => navigate('/settings/computers?open=add-computer')}><I icon={PlusSignIcon} size={14} className="text-pass" />Add a computer…</DropdownMenuItem>
      </MenuCard>
    </DropdownMenu>
    {line && <p role="status" className="m-0 px-2.5 py-1 text-[12.5px]/[1.45] text-body">{line}</p>}
  </>
}

function useMoveAgent(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (to: string) => request({ schema: Agent, path: `/api/agents/${encodeURIComponent(agentId)}`, method: 'PATCH', body: { runsOn: to } }),
    onSuccess: (agent) => {
      client.setQueryData([...AGENTS_KEY, agent.id], agent)
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.map((each) => each.id === agent.id ? { ...each, ...agent, computer: agent.runsOn ?? 'here' } : each))
      for (const queryKey of [COMPUTERS_KEY, ['skills', agent.id], ['memory', agent.id], ['channels']]) void client.invalidateQueries({ queryKey })
    },
  })
}
