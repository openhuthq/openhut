import { useEffect, useState } from 'react'
import { InformationCircleIcon, SidebarRightIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { GLASS, I, ICON_BUTTON, TINY_ICON } from '@/components/kit'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import { ErrorNote } from '@/components/error-note'
import { useQueryClient } from '@tanstack/react-query'
import { AGENT_DIALOGS, agentPath, goneAgentPath, type AgentDialog } from '@/app/routes'
import { useAgent, useAgents } from '@/features/agents/api'
import { BrowserDialog, BrowserPip } from '@/features/agents/browser'
import { ChannelDialog } from '@/features/agents/channels'
import { CustomizeDialog } from '@/features/agents/customize'
import { MemoryDialog } from '@/features/agents/memory-dialog'
import { NewAgentDialog } from '@/features/agents/new-agent'
import { DoesDialog, Panel } from '@/features/agents/panel'
import { SkillsDialog } from '@/features/agents/skills-dialog'
import { RoutinesDialog } from '@/features/routines/routines-dialog'
import { ToolPermissionsDialog } from '@/features/agents/tool-permissions'
import { ActivityDialog } from '@/features/agents/activity-dialog'
import { KeysDialog } from '@/features/agents/secrets'
import { WebhooksDialog } from '@/features/webhooks/webhooks-dialog'
import { NotifyDialog } from '@/features/agents/notify'
import { ThreadsDialog } from '@/features/threads/threads-dialog'
import { Chat } from '@/features/threads/chat'
import { RequestError } from '@/lib/api-client'
import { AGENTS_KEY } from '@/lib/query-keys'
import { PHONE, useMedia } from '@/lib/media'
import { navigate, open, Redirect, useOpen } from '@/lib/router'
import { SetupDialog } from '@/features/agents/setup-dialog'
import { AddAppDialog } from '@/features/connections/add-app'

export function AgentView({ agentId, threadId, dialog, detail }: { agentId: string; threadId?: string; dialog: AgentDialog | undefined; detail: string | undefined }) {
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
  const [shown, setShown] = useState(() => phone ? null : savedShown())
  useEffect(() => { if (!phone) saveShown(shown) }, [phone, shown])
  const open = shown ?? !narrow
  const [browsing, setBrowsing] = useState(false)
  const [pipClosed, setPipClosed] = useState(false)
  useEffect(() => { if (!browsing) setPipClosed(false) }, [browsing])
  if (away) return <Redirect to={away} />
  if (!agent.data) return <>
    <section className="grid flex-1 place-items-center bg-card">{!gone && <ErrorNote message={agent.error?.message} />}</section>
    {!phone && open && <aside className={cn('w-[340px] shrink-0 border-l-[0.5px] border-hair', GLASS)} />}
  </>
  const label = open ? 'Hide panel' : 'Show panel'
  const toggle = phone
    ? !open && <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Show details" title="Show details" onClick={() => setShown(true)}><I icon={InformationCircleIcon} size={20} /></Button>
    : <Tooltip label={label}><Button type="button" variant="bare" aria-label={label} aria-pressed={open} onClick={() => setShown(!open)} className={cn(TINY_ICON, 'aria-pressed:bg-picked')}><I icon={SidebarRightIcon} size={16} /></Button></Tooltip>
  const dialogs = <Dialogs agent={agent.data} dialog={dialog} detail={detail} />
  const panel = <Panel agent={agent.data} threadId={threadId} naming={dialog === 'name'} collapsed={!open} onBrowser={browsing && pipClosed ? () => setPipClosed(false) : undefined} />
  return <>
    <div className="relative flex min-w-0 flex-1">
      <Chat key={threadId} agent={agent.data} threadId={threadId ?? agent.data.id} tools={toggle} onTitle={phone ? () => setShown(true) : undefined} />
      {agent.data.browser && agent.data.canEdit && dialog !== 'browser' && <BrowserPip agent={agent.data} hidden={pipClosed} onClose={() => setPipClosed(true)} onBrowsing={setBrowsing} />}
    </div>
    {phone ? <>{open && <Dialog size="window" label={`${agent.data.name}'s details`} className="phone:bg-sidebar" onClose={() => setShown(false)}>{panel}</Dialog>}{dialogs}</> : <>{panel}{dialogs}</>}
  </>
}

function Dialogs({ agent, dialog, detail, onClose }: { agent: Agent; dialog: AgentDialog | undefined; detail: string | undefined; onClose?: () => void }) {
  const close = onClose ?? (() => navigate(agentPath({ agentId: agent.id })))
  switch (dialog) {
    case 'setup': return <SetupDialog agent={agent} tab={detail} onClose={close}><SetupChild agent={agent} /></SetupDialog>
    case 'new': return <NewAgentDialog onClose={close} />
    case 'does': return <DoesDialog agent={agent} onClose={close} />
    case 'customize': return agent.canEdit ? <CustomizeDialog agent={agent} onClose={close} /> : null
    case 'memory': return <MemoryDialog agent={agent} onClose={close} />
    case 'routines': return <RoutinesDialog agent={agent} open={detail} onClose={close} />
    case 'skills': return <SkillsDialog agent={agent} open={detail} onClose={close} />
    case 'slack':
    case 'whatsapp':
    case 'telegram':
    case 'discord': return <ChannelDialog agent={agent} kind={dialog} onClose={close} />
    case 'apps': return detail ? <ToolPermissionsDialog agent={agent} connectionId={detail} onClose={close} /> : null
    case 'activity': return <ActivityDialog agent={agent} onClose={close} />
    case 'keys': return <KeysDialog agent={agent} onClose={close} />
    case 'webhooks': return <WebhooksDialog agent={agent} onClose={close} />
    case 'threads': return <ThreadsDialog agent={agent} onClose={close} />
    case 'notify': return agent.canEdit ? <NotifyDialog agent={agent} onClose={close} /> : null
    case 'browser': return agent.browser && agent.canEdit ? <BrowserDialog agent={agent} onClose={close} /> : null
    default: return null
  }
}

function SetupChild({ agent }: { agent: Agent }) {
  const [name = '', detail] = (useOpen() ?? '').split(':')
  const back = () => open()
  if (name === 'add-app') return <AddAppDialog onClose={back} />
  const dialog = AGENT_DIALOGS.find((each) => each === name && each !== 'setup')
  return dialog ? <Dialogs agent={agent} dialog={dialog} detail={detail} onClose={back} /> : null
}

const NARROW = '(max-width: 1100px)'
const SHOWN_KEY = 'openhut.details.shown'

function savedShown(): boolean | null {
  try { const saved = localStorage.getItem(SHOWN_KEY); return saved === null ? null : saved === '1' } catch { return null }
}

function saveShown(shown: boolean | null) {
  try { if (shown !== null) localStorage.setItem(SHOWN_KEY, shown ? '1' : '0') } catch { return }
}
