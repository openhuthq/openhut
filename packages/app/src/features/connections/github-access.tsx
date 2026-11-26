import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import { List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'
import { Connection, type Permission, type ToolGroup } from '@openhut/common/connections/connection.ts'
import { GithubInstallation, type CreateGithubConnection } from '@openhut/common/connections/github-app.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Glyph } from '@/components/glyph'
import { I, PILL, SetupSheet } from '@/components/kit'
import { asksKey, useAnswer } from '@/features/asks/api'
import { openSignInTab, useAuthorizeConnection } from '@/features/connections/api'
import { GroupIcon, PermissionPicker } from '@/features/connections/permissions'
import { Check, Row, Rows } from '@/features/settings/kit'
import { Avatar, useAskForGithub, useGithubApp, useGithubSetup, type Sheet } from '@/features/settings/github-app'
import { copyText } from '@/lib/clipboard'
import { formError, request } from '@/lib/api-client'
import { open, useOpen } from '@/lib/router'
import { useIsAdmin } from '@/features/people/api'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const SHOWN = 5
const SKELETON = ['w-40', 'w-28', 'w-36', 'w-24', 'w-32']
const GROUPS: { group: ToolGroup; label: string; permission: Permission }[] = [
  { group: 'read', label: 'Read code', permission: 'allow' },
  { group: 'create', label: 'Open pull requests', permission: 'ask' },
  { group: 'update', label: 'Merge', permission: 'deny' },
]

export function useGithubInstallations(enabled = true) {
  return useQuery({ queryKey: ['github-installations'], queryFn: () => request({ schema: List(GithubInstallation), path: '/api/github-app/installations' }), enabled })
}

const Waits = z.object({ data: z.array(z.object({ askId: z.string(), since: z.string() })) })
type Groups = Partial<Record<ToolGroup, Permission>>

function useWaiting(askId: string, enabled: boolean) {
  return useQuery({ queryKey: ['github-waits', askId], queryFn: () => request({ schema: Waits, path: `/api/github-app/waits?askId=${encodeURIComponent(askId)}` }), enabled, refetchInterval: 60_000 }).data?.data.length ?? 0
}

export function GitHubAskRow({ agent, ask, compact }: { agent: Agent; ask: Ask; compact: boolean }) {
  const info = useGithubApp().data
  const askAdmin = useAskForGithub()
  const admin = useIsAdmin()
  const opened = useOpen() === `connect:${ask.id}`
  const live = ask.status === 'open'
  const waiting = useWaiting(ask.id, live && !!info?.app) > 0
  useGithubInstallations(live && !!info?.app && agent.canEdit)
  const client = useQueryClient()
  const [was, setWas] = useState(false)
  if (was !== waiting) {
    setWas(waiting)
    if (was) void client.invalidateQueries({ queryKey: [...asksKey(agent.id)] })
  }
  const app = info?.app
  const note = !info || !live ? undefined : !app ? (info.asked ? 'Waiting for an admin to set up GitHub' : 'GitHub isn’t set up yet.') : waiting ? `Waiting for the owner to approve ${app.slug}` : undefined
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
      {live && info && <RowAction agent={agent} askId={ask.id} admin={admin} app={!!app} asked={info.asked} waiting={waiting} installUrl={app?.installUrl} onAsk={() => askAdmin.mutate(undefined)} />}
    </div>
    {opened && live && (app || admin) && <GitHubConnectDialog agent={agent} ask={ask} onClose={() => open()} />}
  </>
}

function RowAction({ agent, askId, admin, app, asked, waiting, installUrl, onAsk }: { agent: Agent; askId: string; admin: boolean; app: boolean; asked: boolean; waiting: boolean; installUrl?: string; onAsk: () => void }) {
  if (!app && admin) return <Button type="button" variant="secondary" className={PILL} onClick={() => open(`connect:${askId}`)}>Set up</Button>
  if (!app) return asked ? <Button type="button" variant="ghost" className={cn(PILL, 'text-mute')} disabled>Asked</Button> : <Button type="button" variant="ghost" className={PILL} onClick={onAsk}>Ask an admin</Button>
  if (!agent.canEdit) return <span className="text-[12.5px] text-mute">Waiting for {agent.name}'s owner</span>
  if (waiting && installUrl) return <Button type="button" variant="ghost" className={PILL} onClick={() => void copyText(installUrl).then(() => toast('Link copied', 'Send it to the owner of the account on GitHub.'))}>Copy link</Button>
  return <Button type="button" variant="secondary" className={PILL} onClick={() => open(`connect:${askId}`)}>Connect</Button>
}

function GitHubConnectDialog({ agent, ask, onClose }: { agent: Agent; ask: Ask; onClose: () => void }) {
  const [picking, setPicking] = useState(false)
  const client = useQueryClient()
  const app = useGithubApp().data?.app
  const pick = () => {
    void client.invalidateQueries({ queryKey: ['github-installations'] })
    setPicking(true)
  }
  const setup = useGithubSetup({ onClose, onDone: pick })
  const give = useGiveGithub({ agent, ask, onClose })
  const sheet = !picking && (!app || setup.started) ? setup.sheet : give
  return <SetupSheet modal brand="github" onClose={onClose} {...sheet} />
}

function useGiveGithub({ agent, ask, onClose }: { agent: Agent; ask: Ask; onClose: () => void }): Sheet {
  const app = useGithubApp().data?.app
  const installations = useGithubInstallations(!!app).data?.data
  const client = useQueryClient()
  const answer = useAnswer(agent.id)
  const authorize = useAuthorizeConnection({ stay: true })
  const [blocked, setBlocked] = useState(false)
  const [account, setAccount] = useState<string>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [groups, setGroups] = useState(GROUPS)
  const permissions: Groups = Object.fromEntries(groups.map(({ group, permission }) => [group, permission]))
  const title = 'Connect GitHub'
  const cancel = <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
  const give = (body: CreateGithubConnection) => {
    client.setQueryData<Ask[]>(asksKey(agent.id), (all) => all?.map((each) => each.id === ask.id ? { ...each, status: 'done' } : each))
    onClose()
    void request({ schema: Connection, path: '/api/github-app/connections', method: 'POST', body })
      .then((connection) => answer.mutateAsync({ id: ask.id, verb: 'approvals', body: { answer: { connectionId: connection.id, permissions } } }))
      .catch((err: Error) => {
        toastError(err)
        void client.invalidateQueries({ queryKey: asksKey(agent.id) })
      })
  }
  const install = () => {
    const tab = openSignInTab()
    setBlocked(!tab)
    authorize.mutate({ kind: 'github', askId: ask.id, permissions, tab }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: asksKey(agent.id) })
        onClose()
      },
      onError: () => void client.invalidateQueries({ queryKey: ['github-waits', ask.id] }),
    })
  }
  if (!app || !installations) return {
    title, blurb: `${agent.name} works as ${app ? `${app.slug}[bot]` : 'your team’s bot'}. No sign-in.`,
    foot: <>{cancel}<Button type="button" variant="primary" disabled>Give access</Button></>,
    children: <div className="flex flex-col gap-1" aria-busy="true">
      <span className="text-xs font-medium text-mute">Repositories</span>
      <div className="-mx-2 flex flex-col">{SKELETON.map((width) => <span key={width} className="flex h-8 items-center gap-2.5 px-2"><i className="size-4 rounded-[4px] bg-soft" /><i className="size-5 rounded-[5px] bg-soft" /><i className={cn('h-3 animate-pulse rounded bg-soft', width)} /></span>)}</div>
    </div>,
  }
  const installation = installations.find((each) => each.account.login === account) ?? installations[0]
  const installLabel = authorize.error ? 'Try again' : 'Install on GitHub'
  if (!installation) return {
    title, blurb: 'Install it where the repositories are.',
    error: formError(authorize.error, []),
    safe: 'Not an owner there? GitHub asks the owner for you.',
    foot: <><Button type="button" variant="secondary" onClick={() => void copyText(app.installUrl).then(() => toast('Link copied'))}>Copy link</Button>
      {authorize.isPending && blocked && authorize.url ? <a href={authorize.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'primary' })} onClick={() => setBlocked(false)}>Open GitHub</a>
        : <Button type="button" variant="primary" disabled={authorize.isPending} onClick={install}>{authorize.isPending ? 'Waiting for GitHub…' : installLabel}</Button>}</>,
    children: authorize.isPending ? <Rows><Row icon={<i aria-hidden className="block size-5 animate-pulse rounded-full bg-soft" />} title="Installing on GitHub…" /></Rows> : undefined,
  }
  const shown = more ? installation.repositories : installation.repositories.slice(0, SHOWN)
  const toggle = (repo: string) => setPicked((now) => { const next = new Set(now); if (!next.delete(repo)) next.add(repo); return next })
  const org = installation.account.type === 'Organization'
  return {
    title, blurb: `${agent.name} works as ${app.slug}[bot]. No sign-in.`,
    foot: <>{cancel}<Button type="button" variant="primary" disabled={!picked.size} onClick={() => give({ installationId: installation.installationId, repositories: [...picked] })}>Give access</Button></>,
    children: <>
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
        <span className="text-xs font-medium text-mute">{agent.name} can</span>
        {groups.map((each) => <div key={each.group} className="flex h-9 items-center gap-2.5">
          <GroupIcon group={each.group} />
          <span className="flex-1 text-[13px] text-ink">{each.label}</span>
          <PermissionPicker value={each.permission} label={each.label} onPick={(permission) => setGroups(groups.map((one) => one === each ? { ...one, permission } : one))} />
        </div>)}
      </div>
    </>,
  }
}
