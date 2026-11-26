import type { AgentTool, Permission, ToolGroup } from '@openhut/common/connections/connection.ts'
import { db } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import type { ToolSpec } from '../integrations/connector.ts'
import type { Caller } from '../team/identity.ts'

const OPERATIONS = new Set<string>(['read', 'create', 'update', 'delete'])
const CATCH_ALL = /(^|_)(invoke|call|execute|run)_(a_|any_)?tool$/

export const permissions = {
  groupOf(spec: ToolSpec): ToolGroup {
    const operation = labelOf({ spec, key: 'operation' })
    if (operation && OPERATIONS.has(operation)) return operation as ToolGroup
    if (spec.annotations?.readOnlyHint) return 'read'
    if (isCatchAll(spec)) return 'other'
    if (spec.annotations?.destructiveHint) return 'delete'
    return spec.annotations ? 'update' : 'other'
  },

  defaultOf(spec: ToolSpec): Permission {
    const group = permissions.groupOf(spec)
    if (labelOf({ spec, key: 'risk' }) === 'high') return 'deny'
    if (isCatchAll(spec)) return 'ask'
    if (group === 'delete' || spec.annotations?.destructiveHint === true) return 'deny'
    return group === 'read' ? 'allow' : 'ask'
  },

  async decide({ agentId, connectionId, spec }: { agentId: string; connectionId: string; spec: ToolSpec }): Promise<Permission> {
    const row = await db.selectFrom('tool_permission').select('state').where('agent_id', '=', agentId).where('connection_id', '=', connectionId).where('tool', '=', spec.name).executeTakeFirst()
    return row?.state ?? permissions.defaultOf(spec)
  },

  async list({ agentId, connectionId, tools }: { agentId: string; connectionId: string; tools: ToolSpec[] }): Promise<AgentTool[]> {
    const rows = await db.selectFrom('tool_permission').select(['tool', 'state']).where('agent_id', '=', agentId).where('connection_id', '=', connectionId).execute()
    const set = new Map(rows.map((row) => [row.tool, row.state]))
    return tools.map((spec) => {
      const fallback = permissions.defaultOf(spec)
      const permission = set.get(spec.name) ?? fallback
      return { object: 'agent_tool', agentId, connectionId, name: spec.name, description: spec.annotations?.title || spec.description, group: permissions.groupOf(spec), permission, isDefault: permission === fallback }
    })
  },

  async set({ actor, agentId, connectionId, tools, state }: { actor: Caller; agentId: string; connectionId: string; tools: string[]; state: Permission }): Promise<void> {
    await db.insertInto('tool_permission').values(tools.map((tool) => ({ agent_id: agentId, connection_id: connectionId, tool, state, changed_by: actor.id })))
      .onConflict((oc) => oc.columns(['agent_id', 'connection_id', 'tool']).doUpdateSet((eb) => ({ state: eb.ref('excluded.state'), changed_by: actor.id, changed_at: new Date() }))).execute()
    emit({ name: 'tool_permission.changed', actor, target: { type: 'agent', id: agentId, connectionId, tools: tools.slice(0, 20), state } })
  },

  async reset({ actor, agentId, connectionId }: { actor: Caller; agentId: string; connectionId: string }): Promise<void> {
    await db.deleteFrom('tool_permission').where('agent_id', '=', agentId).where('connection_id', '=', connectionId).execute()
    emit({ name: 'tool_permission.reset', actor, target: { type: 'agent', id: agentId, connectionId } })
  },
}

function isCatchAll(spec: ToolSpec): boolean {
  return !spec.annotations?.readOnlyHint && !labelOf({ spec, key: 'operation' }) && CATCH_ALL.test(spec.name.toLowerCase().replaceAll('-', '_'))
}

function labelOf({ spec, key }: { spec: ToolSpec; key: 'operation' | 'risk' }): string | undefined {
  const meta = spec.meta ?? {}
  const found = [meta, ...Object.values(meta)].find((each) => typeof each === 'object' && each !== null && typeof (each as Record<string, unknown>)[key] === 'string')
  return found ? String((found as Record<string, unknown>)[key]) : undefined
}
