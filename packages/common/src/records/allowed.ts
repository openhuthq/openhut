import type { Member } from '../cloud/cloud.ts'
import { sealedWith } from './seal.ts'
import type { SealedRow } from './wire.ts'

export type Roster = { workspace: string; members: Member[]; viewers: string[]; former: { key: string; email: string }[] }
export type Mode = 'read' | 'write'
export type AgentFacts = { id: string; workspace: string; owner: string; private: boolean }
export type Row = Pick<SealedRow, 'id' | 'object' | 'workspace' | 'parent' | 'by' | 'deleted' | 'body'>

export function agentFacts(agent: Row): AgentFacts | null {
  if (agent.object !== 'agent' || agent.deleted || !agent.parent) return null
  return { id: agent.id, workspace: agent.workspace, owner: agent.parent, private: privateRow(agent) }
}

export function allowed({ row, roster, mode, agent, current }: { row: Row; roster: Roster; mode: Mode; agent?: AgentFacts | null; current?: Row | null }): boolean {
  const writer = writerOf({ roster, device: row.by, mode })
  const moved = current && (current.object !== row.object || current.workspace !== row.workspace || current.parent !== row.parent)
  if (!writer || roster.workspace !== row.workspace || moved || roster.viewers.includes(row.by)) return false
  if (row.object === 'agent') return agentMay({ row, current, writer, mode })
  if (row.object === 'connection') return row.parent === null && writer.role === 'owner'
  if (row.object === 'workspace') return row.id === row.workspace && row.parent === null && writer.role !== 'member'
  if (!agent || agent.id !== row.parent || agent.workspace !== row.workspace) return false
  const owner = writer.email === agent.owner
  if (agent.private && !owner) return false
  if ((row.object === 'control' || row.object === 'memory') && row.id !== row.parent) return false
  if (row.object === 'memory' || row.object === 'skill' || row.object === 'routine') return mode === 'read' || owner || writer.role === 'owner'
  return owner
}

export function runsOnAllowed({ roster, agent, runsOn }: { roster: Roster; agent: AgentFacts; runsOn: string }): boolean {
  return roster.workspace === agent.workspace && writerOf({ roster, device: runsOn, mode: 'write' })?.email === agent.owner && !roster.viewers.includes(runsOn)
}

function agentMay({ row, current, writer, mode }: { row: Row; current?: Row | null; writer: Member; mode: Mode }): boolean {
  const owner = writer.email === row.parent
  if (current === null) return owner
  if (row.deleted) return owner || writer.role !== 'member'
  if (mode === 'write') return owner || writer.role === 'owner'
  return owner || (!privateRow(row) && !(current && privateRow(current)))
}

function privateRow(row: Pick<Row, 'deleted' | 'body'>): boolean {
  return !row.deleted && (sealedWith(row.body)?.includes('own') ?? false)
}

function writerOf({ roster, device, mode }: { roster: Roster; device: string; mode: Mode }): Member | undefined {
  const former = roster.former.find((entry) => entry.key === device)
  if (!former) return roster.members.find((member) => member.devices.includes(device))
  return mode === 'read' ? roster.members.find((member) => member.email === former.email) : undefined
}
