import { useEffect, useState } from 'react'
import { InformationCircleIcon, SidebarRight01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { I, ICON_BUTTON } from '@/components/kit'
import { ErrorNote } from '@/components/error-note'
import { useQueryClient } from '@tanstack/react-query'
import { agentPath, goneAgentPath, type AgentDialog } from '@/app/routes'
import { useAgent, useAgents } from '@/features/agents/api'
import { BrowserDialog } from '@/features/agents/browser'
import { ChannelDialog } from '@/features/agents/channels'
import { MemoryDialog } from '@/features/agents/memory-dialog'
import { HelperModelsSheet } from '@/features/agents/model-rows'
import { NewAgentDialog } from '@/features/agents/new-agent'
import { DoesDialog, Panel } from '@/features/agents/panel'
import { SkillsDialog } from '@/features/agents/skills-dialog'
import { Chat } from '@/features/threads/chat'
import { RequestError } from '@/lib/api-client'
import { AGENTS_KEY } from '@/lib/query-keys'
import { PHONE, useMedia } from '@/lib/media'
import { navigate, Redirect } from '@/lib/router'

export function AgentView({ agentId, dialog, detail }: { agentId: string; dialog: AgentDialog | undefined; detail: string | undefined }) {
  const agent = useAgent(agentId)
  const agents = useAgents()
  const client = useQueryClient()
  const gone = agent.error instanceof RequestError && agent.error.status === 404
  useEffect(() => { if (gone) void client.invalidateQueries({ queryKey: AGENTS_KEY, exact: true }) }, [gone, client])
  const away = gone && agents.data && !agents.isFetching ? goneAgentPath({ agentId, listed: agents.data.map((each) => each.id) }) : undefined
  const { refetch } = agent
  const moved = gone && !!agents.data && !agents.isFetching && !away
  useEffect(() => { if (moved) void refetch() }, [moved, agents.dataUpdatedAt, refetch])
  const narrow = useMedia(NARROW)
  const phone = useMedia(PHONE)
  const [shown, setShown] = useState<boolean | null>(null)
  useEffect(() => setShown(null), [narrow])
  const open = shown ?? !narrow
  if (away) return <Redirect to={away} />
  if (!agent.data) return <section className="grid flex-1 place-items-center bg-card">{!gone && <ErrorNote message={agent.error?.message} />}</section>
  const toggle = narrow && <Button type="button" variant="bare" className={ICON_BUTTON} aria-label={open ? 'Hide details' : 'Show details'} aria-pressed={open} title={open ? 'Hide details' : 'Show details'} onClick={() => setShown(!open)}><I icon={phone ? InformationCircleIcon : SidebarRight01Icon} size={phone ? 20 : 16} /></Button>
  const dialogs = <Dialogs agent={agent.data} dialog={dialog} detail={detail} />
  const panel = open && <Panel agent={agent.data} naming={dialog === 'name'} watching={dialog === 'browser'} />
  return <>
    <Chat agent={agent.data} tools={toggle} onTitle={phone ? () => setShown(true) : undefined} />
    {phone && panel ? <Dialog size="window" label={`${agent.data.name}'s details`} className="phone:bg-sidebar" onClose={() => setShown(false)}>{panel}{dialogs}</Dialog> : <>{panel}{dialogs}</>}
  </>
}

function Dialogs({ agent, dialog, detail }: { agent: Agent; dialog: AgentDialog | undefined; detail: string | undefined }) {
  const close = () => navigate(agentPath({ agentId: agent.id }))
  switch (dialog) {
    case 'new': return <NewAgentDialog onClose={close} />
    case 'does': return <DoesDialog agent={agent} onClose={close} />
    case 'memory': return <MemoryDialog agent={agent} onClose={close} />
    case 'helpers': return <HelperModelsSheet agent={agent} onClose={close} />
    case 'skills': return <SkillsDialog agent={agent} open={detail} onClose={close} />
    case 'slack':
    case 'whatsapp':
    case 'telegram': return <ChannelDialog agent={agent} kind={dialog} onClose={close} />
    case 'browser': return agent.browser && agent.canEdit ? <BrowserDialog agent={agent} onClose={close} /> : null
    default: return null
  }
}

const NARROW = '(max-width: 1100px)'
