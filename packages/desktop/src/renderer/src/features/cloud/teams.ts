import type { OpenHutAgent } from '@openhut/client'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'

type Placed = Pick<OpenHutAgent, 'workspace' | 'computer'>

export function inWorkspace({ agent, active }: { agent: Placed; active: CloudWorkspaceView | undefined }): boolean {
  if (!active) return true
  if (agent.computer !== 'local') return active.home
  return active.home ? !agent.workspace || agent.workspace === active.id : agent.workspace === active.id
}

export function visibleTeams({ workspaces, agents }: { workspaces: CloudWorkspaceView[]; agents: Placed[] | undefined }): CloudWorkspaceView[] {
  const home = workspaces.find((each) => each.home)
  if (!home || !agents || workspaces.length < 2) return workspaces
  const empty = home.members.length <= 1 && home.invites.length === 0 && !agents.some((agent) => inWorkspace({ agent, active: home }))
  return empty ? workspaces.filter((each) => each !== home) : workspaces
}

export function hasTeam(workspaces: CloudWorkspaceView[]): boolean {
  return workspaces.some((each) => !each.home || each.members.length > 1)
}
