import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import { List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'
import { Connection, type Permission, type ToolGroup } from '@openhut/common/connections/connection.ts'
import { GithubInstallation, type CreateGithubConnection } from '@openhut/common/connections/github-app.ts'
import { Button } from '@/components/ui/button'
import { Glyph } from '@/components/glyph'
import { Busy, I, PILL, SetupSheet } from '@/components/kit'
import { asksKey, useAnswer } from '@/features/asks/api'
import { openSignInTab, useAuthorizeConnection } from '@/features/connections/api'
import { GroupIcon, PermissionPicker } from '@/features/connections/permissions'
import { Check } from '@/features/settings/kit'
import { Avatar, useAskForGithub, useGithubApp } from '@/features/settings/github-app'
import { copyText } from '@/lib/clipboard'
import { formError, request } from '@/lib/api-client'
import { navigate, open, useOpen } from '@/lib/router'
import { useIsAdmin } from '@/features/people/api'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const SHOWN = 5
const GROUPS: { group: ToolGroup; label: string; permission: Permission }[] = [
  { group: 'read', label: 'Read code', permission: 'allow' },
  { group: 'create', label: 'Open pull requests', permission: 'ask' },
  { group: 'update', label: 'Merge', permission: 'deny' },
]

export function useGithubInstallations() {
  return useQuery({ queryKey: ['github-installations'], queryFn: () => request({ schema: List(GithubInstallation), path: '/api/github-app/installations' }) })
}

const Waits = z.object({ data: z.array(z.object({ askId: z.string(), since: z.string() })) })
type Groups = Partial<Record<ToolGroup, Permission>>

function useWaiting(askId: string, enabled: boolean) {
  return useQuery({ queryKey: ['github-waits', askId], queryFn: () => request({ schema: Waits, path: `/api/github-app/waits?askId=${encodeURIComponent(askId)}` }), enabled, refetchInterval: 60_000 }).data?.data.length ?? 0
}

export function GitHubAskRow({ agent, ask, compact }: { agent: Agent; ask: Ask; compact: boolean }) {
  const info = useGithubApp().data
  const askAdmin = useAskForGithub()
  const opened = useOpen() === `connect:${ask.id}`
  const live = ask.status === 'open'
  const waiting = useWaiting(ask.id, live && !!info?.app) > 0
  const client = useQueryClient()
  const [was, setWas] = useState(false)
  if (was !== waiting) {
    setWas(waiting)
    if (was) void client.invalidateQueries({ queryKey: [...asksKey(agent.id)] })
  }
  const app = info?.app
  const note = !info || !live ? undefined : !app ? (info.asked ? 'Waiting for an admin to set up GitHub' : 'GitHub isn’t set up on this server yet.') : waiting ? `Waiting for the owner to approve ${app.slug}` : undefined
  const dot = live && ((info && !app && info.asked) || waiting)
  return <>
    <div className={cn('flex min-w-0 items-center gap-3', compact ? 'h-7' : 'min-h-11 rounded-lg px-2')} data-ask={ask.id}>
      <span className="grid size-6 shrink-0 place-items-center"><Glyph name="github" size={compact ? 16 : 20} /></span>
      <span className={cn('flex min-w-0 flex-1 flex-col', compact ? 'text-[13px]' : 'text-[13.5px]')}>
        <span className="flex min-w-0 items-center gap-1 whitespace-nowrap"><span className="shrink-0 text-ink">GitHub</span>{app && !note && <><span className="text-mute">·</span><Avatar url={app.ownerAvatar} name={app.owner} org={app.ownerType === 'Organization'} size={20} /><span className="truncate text-ink">{app.owner}</span></>}</span>
        {note && !compact && <span className="flex items-center gap-1.5 text-[12px] text-mute">{dot && <i className="size-1.5 animate-[blinkdot_1s_infinite] rounded-full bg-amber" />}{note}</span>}
      </span>
      {ask.status === 'done' && <span className={cn('inline-flex items-center gap-1.5 text-ink', compact ? 'text-[12.5px]' : 'h-7 text-[13px]')}><I icon={CheckmarkCircle02Icon} size={compact ? 14 : 16} className="text-hue-green" />{!compact && 'Connected'}</span>}
      {ask.status === 'declined' && <span className="text-[13px] text-mute">Not now</span>}
      {ask.status === 'expired' && <span className="text-[13px] text-mute">Expired</span>}
      {live && info && <RowAction agent={agent} askId={ask.id} app={!!app} asked={info.asked} waiting={waiting} installUrl={app?.installUrl} onAsk={() => askAdmin.mutate(undefined)} />}
    </div>
    {opened && live && app && <GitHubConnectDialog agent={agent} ask={ask} onClose={() => open()} />}
  </>
}

function RowAction({ agent, askId, app, asked, waiting, installUrl, onAsk }: { agent: Agent; askId: string; app: boolean; asked: boolean; waiting: boolean; installUrl?: string; onAsk: () => void }) {
  const admin = useIsAdmin()
  if (!app && admin) return <Button type="button" variant="secondary" className={PILL} onClick={() => navigate('/settings/admin?open=github')}>Set up</Button>
  if (!app) return asked ? <Button type="button" variant="ghost" className={cn(PILL, 'text-mute')} disabled>Asked</Button> : <Button type="button" variant="ghost" className={PILL} onClick={onAsk}>Ask an admin</Button>
  if (!agent.canEdit) return <span className="text-[12.5px] text-mute">Waiting for {agent.name}'s owner</span>
  if (waiting && installUrl) return <Button type="button" variant="ghost" className={PILL} onClick={() => void copyText(installUrl).then(() => toast('Link copied', 'Send it to the owner of the account on GitHub.'))}>Copy link</Button>
  return <Button type="button" variant="secondary" className={PILL} onClick={() => open(`connect:${askId}`)}>Connect</Button>
}

function GitHubConnectDialog({ agent, ask, onClose }: { agent: Agent; ask: Ask; onClose: () => void }) {
  const answer = useAnswer(agent.id)
  const client = useQueryClient()
  const authorize = useAuthorizeConnection({ stay: true })
  const install = (permissions: Groups) => authorize.mutate({ kind: 'github', askId: ask.id, permissions, tab: openSignInTab() }, {
    onSettled: () => void client.invalidateQueries({ queryKey: ['github-waits', ask.id] }).then(onClose),
  })
  return <GiveGitHubDialog agentName={agent.name} onClose={onClose} onInstall={install} installing={authorize.isPending}
    onGive={({ connectionId, permissions }) => answer.mutateAsync({ id: ask.id, verb: 'approvals', body: { answer: { connectionId, permissions } } })} />
}

export function GiveGitHubDialog({ agentName, onGive, onInstall, installing, onClose }: { agentName: string; onGive: (x: { connectionId: string; permissions: Groups }) => Promise<unknown>; onInstall: (permissions: Groups) => void; installing: boolean; onClose: () => void }) {
  const app = useGithubApp().data?.app
  const installations = useGithubInstallations().data?.data
  const [account, setAccount] = useState<string>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [groups, setGroups] = useState(GROUPS)
  const give = useMutation({
    mutationFn: async (body: CreateGithubConnection) => {
      const connection = await request({ schema: Connection, path: '/api/github-app/connections', method: 'POST', body })
      await onGive({ connectionId: connection.id, permissions: Object.fromEntries(groups.map(({ group, permission }) => [group, permission])) })
    },
    onSuccess: onClose,
  })
  if (!app || !installations) return null
  const installation = installations.find((each) => each.account.login === account) ?? installations[0]
  if (!installation) return <InstallFirst agentName={agentName} installUrl={app.installUrl} installing={installing} onInstall={() => onInstall(Object.fromEntries(groups.map(({ group, permission }) => [group, permission])))} onClose={onClose} />
  const shown = more ? installation.repositories : installation.repositories.slice(0, SHOWN)
  const toggle = (repo: string) => setPicked((now) => { const next = new Set(now); if (!next.delete(repo)) next.add(repo); return next })
  const org = installation.account.type === 'Organization'
  return <SetupSheet modal brand="github" title={`Give ${agentName} access to GitHub`} blurb={`${app.name} is installed on ${installation.account.login}. No sign-in needed.`} onClose={onClose}
    error={formError(give.error, ['repositories', 'installationId'])} safe={`${agentName} opens pull requests as ${app.slug}[bot].`}
    foot={<><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>{give.isPending ? <Busy label="Giving access…" /> : <Button type="button" variant="primary" disabled={!picked.size} onClick={() => give.mutate({ installationId: installation.installationId, repositories: [...picked] })}>Give access</Button>}</>}>
    {installations.length > 1 && <div className="flex flex-wrap gap-1.5">{installations.map((each) => <Button key={each.installationId} type="button" variant={each === installation ? 'secondary' : 'ghost'} size="sm" onClick={() => { setAccount(each.account.login); setPicked(new Set()); setMore(false) }}>
      <Avatar url={each.account.avatarUrl} name={each.account.login} org={each.account.type === 'Organization'} size={20} />{each.account.login}</Button>)}</div>}
    <div className="flex flex-col gap-1">
      <span className="flex items-center text-xs font-medium text-mute">Repositories<span className="ml-auto font-normal">{picked.size} of {installation.total}</span></span>
      <div className="-mx-2 flex flex-col">{shown.map((repo) => <Check key={repo} checked={picked.has(repo)} onChange={() => toggle(repo)}>
        <Avatar url={installation.account.avatarUrl} name={installation.account.login} org={org} size={20} /><span className="font-mono text-[12.5px] text-ink">{installation.account.login}/{repo}</span>
      </Check>)}</div>
      {!more && installation.repositories.length > SHOWN && <Button type="button" variant="text" className="w-fit text-[12.5px] font-normal text-mute" onClick={() => setMore(true)}>Show {installation.repositories.length - SHOWN} more</Button>}
    </div>
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-mute">{agentName} will be able to:</span>
      {groups.map((each) => <div key={each.group} className="flex h-9 items-center gap-2.5">
        <GroupIcon group={each.group} />
        <span className="flex-1 text-[13px] text-ink">{each.label}</span>
        <PermissionPicker value={each.permission} label={each.label} onPick={(permission) => setGroups(groups.map((one) => one === each ? { ...one, permission } : one))} />
      </div>)}
    </div>
  </SetupSheet>
}

function InstallFirst({ agentName, installUrl, installing, onInstall, onClose }: { agentName: string; installUrl: string; installing: boolean; onInstall: () => void; onClose: () => void }) {
  return <SetupSheet modal brand="github" title={`Give ${agentName} access to GitHub`} blurb="This server’s GitHub App isn’t installed anywhere yet. Install it on the account that has the repositories." onClose={onClose}
    safe="If you aren’t an owner there, GitHub sends the owner a request. Or copy the link and send it to them."
    foot={<><Button type="button" variant="secondary" onClick={() => void copyText(installUrl).then(() => toast('Link copied'))}>Copy link</Button>{installing ? <Busy label="Waiting for GitHub…" /> : <Button type="button" variant="primary" onClick={onInstall}>Install on GitHub</Button>}</>} />
}
