import type { AgentTool, Permission, ToolGroup } from '@openhut/common/connections/connection.ts'
import { db } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import type { ToolSpec } from '../integrations/connector.ts'
import type { Caller } from '../team/identity.ts'

const OPERATIONS = new Set<string>(['read', 'create', 'update', 'delete'])
const CATCH_ALL = /(^|_)(invoke|call|execute|run)_(a_|any_)?tool$/
const DISCOVERY = /(^|_)(list|find|search|describe|get|retrieve)_(\w+_)?(tools?|schemas?|actions?)$/
const DESTROYS = new Set(['delete', 'remove', 'destroy', 'drop', 'purge', 'wipe'])
const READS = new Set(['list', 'get', 'read', 'search', 'describe', 'fetch'])
const WRITES = new Set(['create', 'add', 'update', 'edit', 'set', 'put', 'patch', 'post', 'write', 'save', 'delete', 'remove', 'destroy', 'drop', 'purge', 'run', 'execute', 'invoke', 'call', 'send', 'start', 'stop', 'restart', 'resize', 'move', 'merge', 'close', 'cancel', 'assign', 'deploy', 'publish', 'upload', 'import', 'push', 'rebuild', 'reset', 'enable', 'disable', 'attach', 'detach'])
const ANY: Record<Exclude<ToolGroup, 'create'>, { description: string; annotations?: ToolSpec['annotations'] }> = {
  read: { description: 'Any other lookup', annotations: { readOnlyHint: true } },
  update: { description: 'Any other change', annotations: { readOnlyHint: false, destructiveHint: false } },
  delete: { description: 'Any other delete or overwrite', annotations: { destructiveHint: true } },
  other: { description: 'Any action the app doesn\'t label' },
}

export const permissions = {
  groupOf(spec: ToolSpec): ToolGroup {
    const operation = labelOf({ spec, key: 'operation' })
    if (operation && OPERATIONS.has(operation)) return operation as ToolGroup
    if (spec.annotations?.readOnlyHint) return 'read'
    if (DISCOVERY.test(snake(spec.name))) return 'read'
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

  isCatchAll,

  undoable(spec: ToolSpec): boolean {
    if (permissions.groupOf(spec) === 'delete' || spec.annotations?.destructiveHint === true) return true
    return !spec.annotations && !labelOf({ spec, key: 'operation' }) && snake(spec.name).split('_').some((word) => DESTROYS.has(word))
  },

  byVerb(spec: ToolSpec): ToolSpec {
    if (spec.annotations || labelOf({ spec, key: 'operation' }) || !readsByName(spec.name)) return spec
    return { ...spec, annotations: { readOnlyHint: true } }
  },

  actions({ specs, discovered }: { specs: ToolSpec[]; discovered: ToolSpec[] }): ToolSpec[] {
    if (!specs.some(isCatchAll)) return specs
    const any = Object.entries(ANY).map(([group, each]) => ({ name: `*${group}`, schema: {}, ...each }))
    return [...specs.filter((spec) => !isCatchAll(spec)), ...discovered, ...any]
  },

  async decide({ agentId, connectionId, spec }: { agentId: string; connectionId: string; spec: ToolSpec }): Promise<Permission> {
    const rows = await db.selectFrom('tool_permission').select(['tool', 'state']).where('agent_id', '=', agentId).where('connection_id', '=', connectionId).where('tool', 'in', [spec.name, `*${permissions.groupOf(spec)}`]).execute()
    return (rows.find((row) => row.tool === spec.name) ?? rows[0])?.state ?? permissions.defaultOf(spec)
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
  return !spec.annotations?.readOnlyHint && !labelOf({ spec, key: 'operation' }) && CATCH_ALL.test(snake(spec.name))
}

function snake(name: string): string {
  return (name.split('/').at(-1) ?? name).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

function readsByName(name: string): boolean {
  const words = snake(name).split('_')
  return words.some((word) => READS.has(word)) && !words.some((word) => WRITES.has(word))
}

function labelOf({ spec, key }: { spec: ToolSpec; key: 'operation' | 'risk' }): string | undefined {
  const meta = spec.meta ?? {}
  const found = [meta, ...Object.values(meta)].find((each) => typeof each === 'object' && each !== null && typeof (each as Record<string, unknown>)[key] === 'string')
  return found ? String((found as Record<string, unknown>)[key]) : undefined
}
