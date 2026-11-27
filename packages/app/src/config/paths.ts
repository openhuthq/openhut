export const AGENT_DIALOGS = ['new', 'does', 'customize', 'memory', 'skills', 'routines', 'slack', 'whatsapp', 'telegram', 'discord', 'browser', 'apps', 'activity', 'keys', 'webhooks', 'notify', 'threads', 'setup'] as const
export type AgentDialog = typeof AGENT_DIALOGS[number]

export function agentPath({ agentId, dialog, detail }: { agentId: string; dialog?: AgentDialog; detail?: string }) {
  return `/agents/${encodeURIComponent(agentId)}${dialog ? `/${dialog}` : ''}${detail ? `/${encodeURIComponent(detail)}` : ''}`
}

export function threadRoute({ agentId, threadId }: { agentId: string; threadId: string }) {
  return threadId === agentId ? agentPath({ agentId }) : `${agentPath({ agentId })}/threads/${encodeURIComponent(threadId)}`
}

export function goneAgentPath({ agentId, listed }: { agentId: string; listed: string[] }) {
  return listed.includes(agentId) ? undefined : '/'
}
