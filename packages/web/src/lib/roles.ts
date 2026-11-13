import type { MemberRole, TeamRole } from '@fastmonkey/common/team/team.ts'

export const ROLE_LABEL: Record<TeamRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export const ROLE_WITH_ARTICLE: Record<MemberRole, string> = { admin: 'an admin', member: 'a member' }

export const MEMBER_ROLES: { value: MemberRole; about: string }[] = [
  { value: 'member', about: 'Builds their own agents and connections.' },
  { value: 'admin', about: "Also invites people and manages the server and everyone's agents." },
]
