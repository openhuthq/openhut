import type { Member, MemberListBody } from '../cloud/cloud.ts'
import { sealedWith } from './seal.ts'
import type { SealedRow } from './wire.ts'

export type Roster = Pick<MemberListBody, 'workspace' | 'members' | 'removed'> & { viewers: string[] }
export type AgentFacts = { id: string; workspace: string; owner: string; private: boolean }
export type Row = Pick<SealedRow, 'id' | 'object' | 'workspace' | 'parent' | 'by' | 'deleted' | 'body'>

export function agentFacts(agent: Row): AgentFacts | null {
  if (agent.object !== 'agent' || agent.deleted || !agent.parent) return null
  return { id: agent.id, workspace: agent.workspace, owner: agent.parent, private: privateRow(agent) }
}

export function allowed({ row, roster, agent, current }: { row: Row; roster: Roster; agent?: AgentFacts | null; current?: Row | null }): boolean {
  const writer = memberOf({ roster, device: row.by })
  const moved = current && (current.object !== row.object || current.workspace !== row.workspace || current.parent !== row.parent)
  if (!writer || roster.workspace !== row.workspace || moved || roster.viewers.includes(row.by)) return false
  const mine = !current || memberOf({ roster, device: current.by })?.email === writer.email
  if (row.object === 'agent') return agentMay({ row, current, writer })
  if (row.object === 'connection') return row.parent === null && writer.role === 'owner' && mine
  if (!agent || agent.id !== row.parent || agent.workspace !== row.workspace) return false
  const owner = writer.email === agent.owner
  if (agent.private && !owner) return false
  if ((row.object === 'control' || row.object === 'memory') && row.id !== row.parent) return false
  if (row.object === 'memory' || row.object === 'skill' || row.object === 'routine') return true
  return owner
}

export function runsOnAllowed({ roster, agent, runsOn }: { roster: Roster; agent: AgentFacts; runsOn: string }): boolean {
  return roster.workspace === agent.workspace && memberOf({ roster, device: runsOn })?.email === agent.owner && !roster.viewers.includes(runsOn)
}

function agentMay({ row, current, writer }: { row: Row; current?: Row | null; writer: Member }): boolean {
  const owner = writer.email === row.parent
  if (current === null) return owner
  if (row.deleted) return owner || writer.role !== 'member'
  return owner || (!privateRow(row) && !(current && privateRow(current)))
}

function privateRow(row: Pick<Row, 'deleted' | 'body'>): boolean {
  return !row.deleted && (sealedWith(row.body)?.includes('own') ?? false)
}

function memberOf({ roster, device }: { roster: Roster; device: string }): Member | undefined {
  return roster.removed.includes(device) ? undefined : roster.members.find((member) => member.devices.includes(device))
}
