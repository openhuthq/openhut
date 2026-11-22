import { Cancel01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { OpenHutConnection } from '@openhut/client'
import { Button, buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { I, Section } from '@/components/kit'
import { useAgents, useCreateGrant, useDeleteGrant, useGrants } from '@/features/agents/api'
import { nameOf, useComputers } from '@/features/computers/api'
import { useAddConnectionTo, useConnections } from '@/features/connections/api'
import { connectionOf, holds } from '@/features/connections/copies'
import { toast, toastError } from '@/lib/toast'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

export function CanUse({ agent }: { agent: Agent }) {
  const connections = useConnections()
  const grants = useGrants({ agentId: agent.id })
  const deleteGrant = useDeleteGrant()
  const granted = (grants.data ?? []).flatMap((grant) => {
    const connection = connectionOf({ connections: connections.data, id: grant.connectionId })
    return connection ? [{ grant, connection }] : []
  })
  const others = (connections.data ?? []).filter((connection) => !grants.data?.some((grant) => holds({ connection, id: grant.connectionId })))
  return <Section title="Can use" action={<AddConnection agent={agent} connections={others} />}>
    <ErrorNote message={connections.error?.message ?? grants.error?.message} />
    {grants.data && !granted.length && <p className="m-0 text-[12px]/[16px] text-balance text-mute">{agent.name} can't use any connection yet.</p>}
    <div className="flex flex-wrap gap-1.5">{granted.map(({ grant, connection }) => <span key={grant.id} className="group inline-flex h-6 items-center gap-1.5 rounded-md bg-picked pr-2 pl-1.5 text-[12px] text-ink">
      <Glyph name={connection.kind} size={13} />{connection.name}
      {agent.canEdit && <Button type="button" variant="bare" aria-label={`Remove ${connection.name}`} title="Remove" disabled={deleteGrant.isPending} onClick={() => deleteGrant.mutate(grant, { onError: toastError })}
        className="-mr-1 grid size-4 place-items-center rounded-full text-mute opacity-0 group-hover:opacity-100 hover:bg-soft hover:text-ink focus-visible:opacity-100"><I icon={Cancel01Icon} size={11} /></Button>}
    </span>)}</div>
  </Section>
}

function AddConnection({ agent, connections }: { agent: Agent; connections: OpenHutConnection[] }) {
  const createGrant = useCreateGrant()
  const addTo = useAddConnectionTo()
  const computers = useComputers().data
  const home = useAgents().data?.find((each) => each.id === agent.id)?.computer ?? 'local'
  const there = nameOf({ computers, id: home })
  return <DropdownMenu>
    <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'text' }), 'text-xs')} disabled={!agent.canEdit || createGrant.isPending}><I icon={PlusSignIcon} size={12} />Add</DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {connections.map((connection) => {
        const missing = !connection.computers.some((copy) => copy.computer === home)
        const pick = () => missing
          ? addTo.mutate({ id: connection.id, computer: home }, { onSuccess: () => toast(`${connection.name} is on ${there} now. Add it again so ${agent.name} can use it.`), onError: toastError })
          : createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })
        return <DropdownMenuItem size="tall" key={connection.id} disabled={addTo.isPending} onClick={pick}>
          <Glyph name={connection.kind} size={16} />
          <span className="flex min-w-0 flex-col"><span className="truncate">{connection.name}</span>{missing && <span className="text-xs whitespace-normal text-mute">Add to {there}</span>}</span>
        </DropdownMenuItem>
      })}
      {connections.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onClick={() => navigate('/connections')}><I icon={PlusSignIcon} size={14} />New connection</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
