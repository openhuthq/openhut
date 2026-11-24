import type { OpenHutAgent } from '@/lib/openhut'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'

type Placed = Pick<OpenHutAgent, 'workspace' | 'computer'>

export function inWorkspace({ agent, active }: { agent: Placed; active: Pick<CloudWorkspaceView, 'id' | 'home'> }): boolean {
  return agent.workspace ? agent.workspace === active.id : active.home
}
