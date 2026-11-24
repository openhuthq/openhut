import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'

export function shownTeams({ all, active, homeAgents }: { all: CloudWorkspaceView[]; active: string; homeAgents: number }): CloudWorkspaceView[] {
  const unused = (team: CloudWorkspaceView) => team.home && team.id !== active && team.members.length === 1 && !team.invites.length && !homeAgents
  return all.length > 1 ? all.filter((team) => !unused(team)) : all
}
