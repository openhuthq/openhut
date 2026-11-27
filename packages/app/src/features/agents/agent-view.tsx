import { useEffect, useState } from 'react'
import { InformationCircleIcon, MessageMultiple01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { GLASS, HEADER_ACTION, I, ICON_BUTTON } from '@/components/kit'
import { PanelThreads } from '@/features/threads/thread-list'
import { cn } from '@/lib/utils'
import { ErrorNote } from '@/components/error-note'
import { useQueryClient } from '@tanstack/react-query'
import { AGENT_DIALOGS, agentPath, goneAgentPath, type AgentDialog } from '@/app/routes'
import { useAgent, useAgents } from '@/features/agents/api'
import { BrowserDialog, BrowserPip } from '@/features/agents/browser'
import { ChannelDialog } from '@/features/agents/channels'
import { CustomizeDialog } from '@/features/agents/customize'
import { NewAgentDialog } from '@/features/agents/new-agent'
import { AgentActions, DoesDialog, FloatingThreads } from '@/features/agents/panel'
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
  const phone = useMedia(PHONE)
  const [threadsOpen, setThreadsOpen] = useState(savedShown)
  useEffect(() => saveShown(threadsOpen), [threadsOpen])
  const [details, setDetails] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [pipClosed, setPipClosed] = useState(false)
  useEffect(() => { if (!browsing) setPipClosed(false) }, [browsing])
  if (away) return <Redirect to={away} />
  if (!agent.data) return <section className="grid flex-1 place-items-center bg-card">{!gone && <ErrorNote message={agent.error?.message} />}</section>
  const threadsToggle = <Button type="button" variant="bare" data-threads-toggle aria-label="Threads" aria-pressed={!phone && threadsOpen} onClick={() => phone ? setDetails(true) : setThreadsOpen(!threadsOpen)} className={cn(HEADER_ACTION, 'aria-pressed:bg-picked')}><I icon={MessageMultiple01Icon} size={15} />Threads</Button>
  const dialogs = <Dialogs agent={agent.data} dialog={dialog} detail={detail} />
  const actions = <AgentActions agent={agent.data} threads={threadsToggle} onBrowser={browsing && pipClosed ? () => setPipClosed(false) : undefined} />
  return <>
    <div className="group/chat relative flex min-w-0 flex-1" data-threads={!phone && threadsOpen ? '' : undefined}>
      <Chat key={threadId} agent={agent.data} threadId={threadId ?? agent.data.id} actions={actions}
        tools={phone && <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Details" title="Details" onClick={() => setDetails(true)}><I icon={InformationCircleIcon} size={20} /></Button>}
        onTitle={phone ? () => setDetails(true) : undefined} />
      {!phone && threadsOpen && <FloatingThreads agent={agent.data} threadId={threadId} onClose={() => setThreadsOpen(false)} />}
      {agent.data.browser && agent.data.canEdit && dialog !== 'browser' && <BrowserPip agent={agent.data} hidden={pipClosed} onClose={() => setPipClosed(true)} onBrowsing={setBrowsing} />}
    </div>
    {phone && details && <Dialog size="window" label={agent.data.name} className="phone:bg-sidebar" onClose={() => setDetails(false)}>
      <div className={cn('flex flex-1 flex-col p-6', GLASS)}><PanelThreads agent={agent.data} threadId={threadId} /></div>
    </Dialog>}
    {dialogs}
  </>
}

function Dialogs({ agent, dialog, detail, onClose }: { agent: Agent; dialog: AgentDialog | undefined; detail: string | undefined; onClose?: () => void }) {
  const close = onClose ?? (() => navigate(agentPath({ agentId: agent.id })))
  switch (dialog) {
    case 'setup': return <SetupDialog agent={agent} tab={detail} onClose={close}><SetupChild agent={agent} /></SetupDialog>
    case 'new': return <NewAgentDialog onClose={close} />
    case 'does': return <DoesDialog agent={agent} onClose={close} />
    case 'customize': return agent.canEdit ? <CustomizeDialog agent={agent} onClose={close} /> : null
    case 'memory':
    case 'routines': return <RoutinesDialog agent={agent} open={detail} onClose={close} />
    case 'skills': return <SetupDialog agent={agent} tab={dialog} onClose={close}><SetupChild agent={agent} /></SetupDialog>
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

const SHOWN_KEY = 'openhut.threads.shown'

function savedShown(): boolean {
  try { return localStorage.getItem(SHOWN_KEY) === '1' } catch { return false }
}

function saveShown(shown: boolean) {
  try { localStorage.setItem(SHOWN_KEY, shown ? '1' : '0') } catch { return }
}
