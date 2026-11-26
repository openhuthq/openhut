import { Cancel01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { I, Section } from '@/components/kit'
import { useCreateGrant, useDeleteGrant, useGrants } from '@/features/agents/api'
import { useConnections } from '@/features/connections/api'
import { toastError } from '@/lib/toast'
import { navigate } from '@/lib/router'
import { agentPath } from '@/app/routes'
import { connectionBrand } from '@/features/connections/catalog'
import { cn } from '@/lib/utils'

export function CanUse({ agent }: { agent: Agent }) {
  const connections = useConnections()
  const grants = useGrants({ agentId: agent.id })
  const deleteGrant = useDeleteGrant()
  const granted = (grants.data ?? []).flatMap((grant) => {
    const connection = connections.data?.find((each) => each.id === grant.connectionId)
    return connection ? [{ grant, connection }] : []
  })
  const others = (connections.data ?? []).filter((connection) => !grants.data?.some((grant) => grant.connectionId === connection.id))
  return <Section title="Can use" action={<AddConnection agent={agent} connections={others} />}>
    <ErrorNote message={(connections.error ?? grants.error)?.message} />
    {grants.data && !granted.length && <p className="m-0 text-[12px]/[16px] text-balance text-mute">{agent.name} can't use any connection yet.</p>}
    <div className="flex flex-wrap gap-1.5">{granted.map(({ grant, connection }) => <span key={grant.id} className="group inline-flex h-6 items-center gap-1.5 rounded-md bg-picked pr-2 pl-1.5 text-[12px] text-ink">
      <a href={agentPath({ agentId: agent.id, dialog: 'apps', detail: connection.id })} className="inline-flex items-center gap-1.5 text-ink no-underline" title={`What ${agent.name} may do`}><Glyph name={connectionBrand(connection)} size={13} />{connection.name}</a>
      {agent.canEdit && <Button type="button" variant="bare" aria-label={`Remove ${connection.name}`} title="Remove" disabled={deleteGrant.isPending} onClick={() => deleteGrant.mutate(grant, { onError: toastError })}
        className="-mr-1 grid size-4 place-items-center rounded-full text-mute opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 hover:bg-soft hover:text-ink focus-visible:opacity-100"><I icon={Cancel01Icon} size={11} /></Button>}
    </span>)}</div>
  </Section>
}

function AddConnection({ agent, connections }: { agent: Agent; connections: Connection[] }) {
  const createGrant = useCreateGrant()
  return <DropdownMenu>
    <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'text' }), 'text-xs')} disabled={!agent.canEdit || createGrant.isPending}><I icon={PlusSignIcon} size={12} />Add</DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {connections.map((connection) => <DropdownMenuItem size="tall" key={connection.id} onClick={() => createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })}>
        <Glyph name={connectionBrand(connection)} size={16} /><span className="truncate">{connection.name}</span>
      </DropdownMenuItem>)}
      {connections.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onClick={() => navigate('/connections')}><I icon={PlusSignIcon} size={14} />New connection</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
