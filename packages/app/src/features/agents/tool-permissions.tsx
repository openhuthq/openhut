import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ToolGroup, type AgentTool, type Permission } from '@openhut/common/connections/connection.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { DialogCard, I, Loading } from '@/components/kit'
import { Details } from '@/features/agents/request-card'
import { connectionBrand } from '@/features/connections/catalog'
import { useAgentTools, useConnections, useResetToolPermissions, useSetToolPermission } from '@/features/connections/api'
import { GROUPS, GroupIcon, PermissionPicker } from '@/features/connections/permissions'
import { toolLabel } from '@/lib/tool-label'
import { toastError } from '@/lib/toast'

const nameOf = (tool: AgentTool) => tool.description && tool.description.length <= 60 ? tool.description : toolLabel(tool.name)

export function ToolPermissionsDialog({ agent, connectionId, onClose }: { agent: Agent; connectionId: string; onClose: () => void }) {
  const connection = useConnections().data?.find((each) => each.id === connectionId)
  const tools = useAgentTools({ agentId: agent.id, connectionId })
  const reset = useResetToolPermissions({ agentId: agent.id, connectionId })
  const changed = tools.data?.some((tool) => !tool.isDefault)
  const groups = ToolGroup.options.map((group) => ({ group, tools: tools.data?.filter((tool) => tool.group === group) ?? [] })).filter((each) => each.tools.length)
  return <DialogCard onClose={onClose} className="max-h-[min(720px,calc(100vh-48px))] w-[520px] gap-0 overflow-hidden p-0">
    <div className="flex items-center gap-3 px-6 pt-6 pb-4">
      {connection && <Glyph name={connectionBrand(connection)} size={28} />}
      <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">What {agent.name} may do in {connection?.name ?? '…'}</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mt-1 -mr-2" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-2">
      <ErrorNote message={tools.error?.message} />
      {!tools.data && !tools.error && <Loading />}
      {tools.data && <div className="flex flex-col gap-1">{groups.map(({ group, tools: members }) => <GroupRow key={group} agent={agent} connectionId={connectionId} group={group} tools={members} />)}</div>}
    </div>
    <div className="flex items-center gap-2 px-6 pt-4 pb-6">
      <Button type="button" variant="ghost" className="-ml-3" disabled={!changed || !agent.canEdit || reset.isPending} onClick={() => reset.mutate(undefined, { onError: toastError })}>Reset to defaults</Button>
      <Button type="button" variant="primary" className="ml-auto" onClick={onClose}>Done</Button>
    </div>
  </DialogCard>
}

function GroupRow({ agent, connectionId, group, tools }: { agent: Agent; connectionId: string; group: ToolGroup; tools: AgentTool[] }) {
  const set = useSetToolPermission()
  const pick = (names: string[]) => (permission: Permission) => set.mutate({ agentId: agent.id, connectionId, tools: names, permission }, { onError: toastError })
  const whole = set.isPending && set.variables.tools.length === tools.length && tools.length > 1
  const first = tools[0]
  const mixed = !whole && tools.some((tool) => tool.permission !== first.permission)
  const { label, line } = GROUPS[group]
  return <div className="flex flex-col py-1.5">
    <div className="flex min-w-0 items-center gap-3">
      <GroupIcon group={group} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink" title={line}>{label}</span>
      <PermissionPicker value={mixed ? undefined : whole ? set.variables.permission : first.permission} label={label} disabled={!agent.canEdit} onPick={pick(tools.map((tool) => tool.name))} />
    </div>
    <div className="pl-7"><Details label={`${tools.length} ${tools.length === 1 ? 'action' : 'actions'}`}>{tools.map((tool) => <div key={tool.name} className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-ink" title={`${tool.name}: ${tool.description}`}>{nameOf(tool)}</span>
      <PermissionPicker value={tool.permission} label={nameOf(tool)} disabled={!agent.canEdit} onPick={pick([tool.name])} />
    </div>)}</Details></div>
  </div>
}
