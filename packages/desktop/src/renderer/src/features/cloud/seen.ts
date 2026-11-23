import type { Cloud } from '@openhut/common/cloud/cloud.ts'

type Workspace = Cloud['workspaces'][number]
export type JoinRequest = { workspace: Workspace; request: Workspace['requests'][number]; mine: boolean; path: string }

export function joinRequests({ cloud }: { cloud: Cloud }): JoinRequest[] {
  return cloud.workspaces.flatMap((workspace) => workspace.requests
    .filter((request) => workspace.own && workspace.home ? request.email === cloud.email : workspace.role !== 'member' && request.email !== cloud.email)
    .map((request) => ({ workspace, request, mine: request.email === cloud.email, path: request.email === cloud.email ? '/settings/computers' : '/settings/people' })))
}
