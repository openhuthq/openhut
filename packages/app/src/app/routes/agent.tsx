import { useEffect, useState } from 'react'
import { Globe02Icon, InformationCircleIcon, MessageMultiple01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { GLASS, I, ICON_BUTTON, TINY_ICON } from '@/components/kit'
import { Tooltip } from '@/components/ui/tooltip'
import { PanelThreads, FloatingThreads } from '@/features/threads/components/thread-list'
import { cn } from '@/lib/utils'
import { ErrorNote } from '@/components/error-note'
import { ErrorBoundary } from '@/components/error-boundary'
import { useQueryClient } from '@tanstack/react-query'
import { AGENT_DIALOGS, agentPath, goneAgentPath, type AgentDialog } from '@/config/paths'
import { useAgent, useAgents } from '@/lib/queries/agents'
import { BrowserCard, BrowserDialog } from '@/features/agents/components/browser'
import { ChannelDialog } from '@/features/agents/channels/channels'
import { CustomizeDialog } from '@/features/agents/components/customize'
import { NewAgentDialog } from '@/features/agents/components/new-agent'
import { NewAgentSteps } from '@/features/models/models-settings'
import { AgentActions, DoesDialog, SyncFace } from '@/features/agents/components/panel'
import { RoutinesDialog } from '@/features/routines/routines-dialog'
import { ToolPermissionsDialog } from '@/features/connections/components/tool-permissions'
import { WebhooksDialog } from '@/features/webhooks/webhooks-dialog'
import { NotifyDialog, PlacePicker } from '@/features/agents/components/notify'
import { ThreadsDialog } from '@/features/threads/components/threads-dialog'
import { Chat } from '@/features/threads/components/chat'
import type { AskSlots } from '@/features/threads/components/messages'
import { AskCards, PendingAsks } from '@/features/asks/card'
import { ASK_KINDS } from '@/app/asks'
import { RequestError } from '@/lib/api-client'
import { AGENTS_KEY } from '@/lib/query-keys'
import { PHONE, useMedia } from '@/lib/media'
import { navigate, open, Redirect, useOpen } from '@/lib/router'
import { SetupDialog } from '@/features/agents/components/setup-dialog'
import { AddAppDialog } from '@/features/connections/components/add-app'

const ASKS: AskSlots = {
  Cards: (props) => <AskCards kinds={ASK_KINDS} {...props} />,
  Pending: (props) => <PendingAsks kinds={ASK_KINDS} {...props} />,
}

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
  const [side, setSide] = useState(savedSide)
  useEffect(() => saveSide(side), [side])
  const [details, setDetails] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  useEffect(() => { if (browsing) setSide((open) => open ?? 'browser') }, [browsing])
  const flip = (card: Side) => setSide(side === card ? null : card)
  if (away) return <Redirect to={away} />
  if (!agent.data) return <section className="grid flex-1 place-items-center bg-card">{!gone && <ErrorNote message={agent.error?.message} />}</section>
  const threadsToggle = <Tooltip label="Threads"><Button type="button" variant="bare" data-threads-toggle aria-label="Threads" aria-pressed={!phone && side === 'threads'} onClick={() => phone ? setDetails(true) : flip('threads')} className={cn(TINY_ICON, 'aria-pressed:bg-picked')}><I icon={MessageMultiple01Icon} size={16} /></Button></Tooltip>
  const dialogs = <Dialogs agent={agent.data} dialog={dialog} detail={detail} />
  const hasBrowser = !phone && agent.data.browser && agent.data.canEdit
  const browserToggle = hasBrowser && <Tooltip label="Browser"><Button type="button" variant="bare" aria-label="Browser" aria-pressed={side === 'browser'} onClick={() => flip('browser')} className={cn(TINY_ICON, 'relative aria-pressed:bg-picked')}><I icon={Globe02Icon} size={16} />{browsing && <i aria-label="Live" className="absolute top-[5px] right-[5px] size-1.5 rounded-full bg-pass shadow-[0_0_0_2px_var(--card)]" />}</Button></Tooltip>
  const actions = <AgentActions agent={agent.data} threads={<>{browserToggle}{threadsToggle}</>} />
  return <>
    <SyncFace agent={agent.data} />
    <div className="group/chat relative flex min-w-0 flex-1" data-threads={!phone && side ? '' : undefined}>
      <ErrorBoundary key={threadId}><Chat agent={agent.data} threadId={threadId ?? agent.data.id} asks={ASKS} actions={actions}
        tools={phone && <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Details" title="Details" onClick={() => setDetails(true)}><I icon={InformationCircleIcon} size={20} /></Button>}
        onTitle={phone ? () => setDetails(true) : undefined} /></ErrorBoundary>
      {!phone && side === 'threads' && <FloatingThreads agent={agent.data} threadId={threadId} onClose={() => setSide(null)} />}
      {hasBrowser && dialog !== 'browser' && <BrowserCard agent={agent.data} open={side === 'browser'} onClose={() => setSide(null)} onBrowsing={setBrowsing} />}
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
    case 'new': return <NewAgentDialog onClose={close} modelSteps={NewAgentSteps} />
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
    case 'activity':
    case 'keys': return <SetupDialog agent={agent} tab={dialog} onClose={close}><SetupChild agent={agent} /></SetupDialog>
    case 'webhooks': return <WebhooksDialog agent={agent} placePicker={(props) => <PlacePicker agentId={agent.id} none="Here in the web app" label="Runs in" className="w-[260px]" {...props} />} onClose={close} />
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

type Side = 'threads' | 'browser' | null
const SIDE_KEY = 'openhut.side'

function savedSide(): Side {
  try { return localStorage.getItem(SIDE_KEY) === 'threads' ? 'threads' : null } catch { return null }
}

function saveSide(side: Side) {
  try { localStorage.setItem(SIDE_KEY, side ?? '') } catch { return }
}
