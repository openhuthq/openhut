import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { GithubAccount, GithubAppInfo, GithubAppLaunch, type CreateGithubApp } from '@openhut/common/connections/github-app.ts'
import { List } from '@openhut/common/api.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Glyph } from '@/components/glyph'
import { Busy, I, PILL, SetupSheet } from '@/components/kit'
import { Field } from '@/features/connections/sheet'
import { Row, Rows } from '@/features/settings/kit'
import { fieldError, formError, request } from '@/lib/api-client'
import { open } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const KEY = ['github-app']
const LOGIN = 'openhut.github.login'
const PATH = '/api/github-app'

export function useGithubApp(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => request({ schema: GithubAppInfo, path: PATH }), enabled })
}

function useGithubAppChange<T>(fn: (body: T) => Promise<GithubAppInfo>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: (info) => client.setQueryData(KEY, info), onError: toastError })
}

export function useAskForGithub() {
  return useGithubAppChange(() => request({ schema: GithubAppInfo, path: `${PATH}/requests`, method: 'POST' }))
}

export function GitHubRow() {
  const info = useGithubApp().data
  if (!info) return null
  const app = info.app
  const asked = info.askedBy.length ? ` · ${info.askedBy.join(', ')} asked for it` : ''
  return <Row icon={<Glyph name="github" size={20} />} title="GitHub" note={app ? `${app.name} · on ${app.owner}${repos(app.repositories, ' · installed on ')}` : `Not set up · Lets agents open pull requests as your own GitHub App${asked}`}>
    <Button type="button" variant="ghost" className={PILL} onClick={() => open('github')}>{app ? 'Manage' : 'Set up'}</Button>
  </Row>
}

export function GitHubDialogs({ opened }: { opened: string | null }) {
  const info = useGithubApp().data
  if (!info || !opened?.startsWith('github')) return null
  const close = () => open()
  if (!info.app) return opened === 'github' ? <SetupGitHubDialog onClose={close} /> : null
  if (opened === 'github-done') return <DoneStep info={info} onClose={close} />
  return <ManageGitHubDialog info={info} onClose={close} />
}

function repos(count: number | null, before: string): string {
  if (count === null) return ''
  return `${before}${count} ${count === 1 ? 'repository' : 'repositories'}`
}

export function Avatar({ url, name, org, size = 24 }: { url: string; name: string; org: boolean; size?: number }) {
  const [broken, setBroken] = useState(false)
  const shape = org ? 'rounded-[5px]' : 'rounded-full'
  if (broken || !url) return <span className={cn(size === 20 ? 'size-5' : 'size-6', 'grid shrink-0 place-items-center bg-ink text-[11px] font-semibold text-card', shape)}>{name[0]?.toUpperCase()}</span>
  return <img src={url} alt="" width={size} height={size} onError={() => setBroken(true)} className={cn('shrink-0 object-cover shadow-[0_0_0_1px_var(--hair)]', shape)} />
}

function BotPreview({ name, children }: { name: string; children: ReactNode }) {
  return <div className="flex items-center gap-2.5 rounded-lg bg-sidebar px-3 py-2.5">
    <span className="grid size-9 shrink-0 place-items-center rounded-[6px] bg-card shadow-[0_0_0_1px_var(--hair)]"><Glyph name="openhut" size={24} /></span>
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1 text-[12.5px] text-body">Agents’ pull requests will show as <span className="font-medium text-ink">{name}[bot]</span><BotTag /></span>
      <span className="text-[12px] text-mute">{children}</span>
    </span>
  </div>
}

const BotTag = () => <span className="rounded-full border border-hair px-1.5 text-[11px]/[16px] text-mute">bot</span>

function remembered(): string {
  try { return localStorage.getItem(LOGIN) ?? '' } catch { return '' }
}

function SetupGitHubDialog({ onClose }: { onClose: () => void }) {
  const [login, setLogin] = useState(remembered)
  const accounts = useMutation({
    mutationFn: (who: string) => request({ schema: List(GithubAccount), path: `${PATH}/accounts?login=${encodeURIComponent(who)}` }),
    onSuccess: (found, who) => {
      try { localStorage.setItem(LOGIN, who) } catch { /* private window */ }
      const first = found.data.find((each) => each.type === 'Organization') ?? found.data[0]
      if (first) pick(first)
    },
  })
  const [owner, setOwner] = useState<GithubAccount>()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: (body: CreateGithubApp) => request({ schema: GithubAppLaunch, path: PATH, method: 'POST', body }),
    onSuccess: ({ url }) => location.assign(url),
  })
  const pick = (account: GithubAccount) => { setOwner(account); setName(account.appName) }
  useEffect(() => { if (login) accounts.mutate(login) }, [])
  const list = accounts.data?.data ?? []
  const find = () => { if (login.trim()) accounts.mutate(login.trim()) }
  return <SetupSheet modal brand="github" title="Set up GitHub" blurb="One GitHub App for this server. Agents open pull requests as it, not as you." onClose={onClose}
    error={formError(create.error, ['name', 'owner']) ?? formError(accounts.error, ['login'])}
    safe={owner ? `${owner.type === 'Organization' ? `You need to be an owner of ${owner.login}. ` : ''}GitHub opens next to confirm.` : undefined}
    onSubmit={(event) => { event.preventDefault(); if (owner) create.mutate({ owner: owner.login, ownerType: owner.type, name: name.trim() }) }}
    foot={<><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>{create.isPending || create.isSuccess ? <Busy label="Opening GitHub…" /> : <Button type="submit" variant="primary" disabled={!owner || !name.trim()}>Continue on GitHub</Button>}</>}>
    <Field label="Your GitHub username or organization" error={fieldError(accounts.error, 'login')}>
      <span className="flex gap-2"><Input mono value={login} onInput={(event) => setLogin(event.currentTarget.value)} onBlur={find} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); find() } }} placeholder="octocat" autoComplete="off" aria-label="GitHub username" />
        {accounts.isPending ? <Busy label="Looking…" /> : !list.length && <Button type="button" variant="secondary" onClick={find}>Find</Button>}</span>
    </Field>
    {list.length > 0 && <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-mute">Create the app on</span>
      <RadioGroup key={list.map((each) => each.login).join()} name="app-owner" variant="card" onChange={(event) => { const found = list.find((each) => each.login === (event.target as HTMLInputElement).value); if (found) pick(found) }}>
        {list.map((account) => <RadioGroupItem key={account.login} value={account.login} defaultChecked={account.login === owner?.login} className="grid-cols-[16px_24px_minmax(0,1fr)] items-center [&>input]:row-span-1 [&>input]:mt-0">
          <Avatar url={account.avatarUrl} name={account.name} org={account.type === 'Organization'} />
          <span className="flex min-w-0 flex-col"><span className="text-[13px] text-ink">{account.name}</span><span className="text-[12px] text-mute">{account.type === 'User' ? 'Personal account' : 'Organization'}</span></span>
        </RadioGroupItem>)}
      </RadioGroup>
    </div>}
    {owner && <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-mute">App name</span>
      <Input mono value={name} maxLength={34} onInput={(event) => setName(event.currentTarget.value)} aria-label="App name" />
      <div className="mt-1.5"><BotPreview name={name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')}>Confirm on GitHub and it’s ready</BotPreview></div>
    </div>}
  </SetupSheet>
}

function AppCard({ name, note }: { name: string; note: string }) {
  return <div className="flex items-center gap-3.5 rounded-lg bg-sidebar px-3.5 py-3">
    <span className="grid size-14 shrink-0 place-items-center rounded-[10px] bg-card shadow-[0_0_0_1px_var(--hair)]"><Glyph name="openhut" size={38} /></span>
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[13px] text-ink"><span className="font-medium">{name}[bot]</span><BotTag /></span>
      <span className="text-[12px] text-mute">{note}</span>
    </span>
    <I icon={CheckmarkCircle02Icon} size={20} className="text-hue-green" />
  </div>
}

function DoneStep({ info, onClose }: { info: GithubAppInfo; onClose: () => void }) {
  const app = info.app
  if (!app) return null
  return <SetupSheet modal brand="github" title="GitHub is set up" blurb={`${app.name} is ready. Agents can open pull requests on ${app.owner}.`} onClose={onClose}
    foot={<Button type="button" variant="primary" onClick={onClose}>Done</Button>}>
    <AppCard name={app.slug} note={`Created on ${app.owner}${repos(app.repositories, ' · installed on ')}`} />
  </SetupSheet>
}

function ManageGitHubDialog({ info, onClose }: { info: GithubAppInfo; onClose: () => void }) {
  const app = info.app
  const remove = useGithubAppChange(() => request({ schema: GithubAppInfo, path: PATH, method: 'DELETE' }))
  if (!app) return null
  const link = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'ghost' }), PILL)}>{label}</a>
  return <SetupSheet modal brand="github" title="GitHub" blurb="This server’s GitHub App. Agents open pull requests as it." onClose={onClose}
    safe="Removing it disconnects every GitHub connection on this server."
    foot={<><Button type="button" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: onClose })}>Remove</Button><Button type="button" variant="primary" onClick={onClose}>Done</Button></>}>
    <Rows>
      <Row icon={<Avatar url={app.ownerAvatar} name={app.owner} org={app.ownerType === 'Organization'} size={20} />} title={`${app.name}[bot]`} note={`On ${app.owner}`}>{link(app.settingsUrl, 'Edit')}</Row>
      <Row icon={<Glyph name="github" size={20} />} title="Installed on" note={app.repositories === null ? 'GitHub didn’t answer' : repos(app.repositories, '')}>{link(app.installUrl, 'Install')}</Row>
    </Rows>
  </SetupSheet>
}

