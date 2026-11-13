import type { MemberRole, TeamRole } from '@fastmonkey/common/team/team.ts'

export const ROLE_LABEL: Record<TeamRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export const ROLE_WITH_ARTICLE: Record<MemberRole, string> = { admin: 'an admin', member: 'a member' }
