import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { CheckmarkCircle02Icon, CircleIcon } from '@hugeicons/core-free-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GithubAppInfo, GithubAppLaunch, type CreateGithubApp } from '@openhut/common/connections/github-app.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Glyph } from '@/components/glyph'
import { ConfirmButton } from '@/components/confirm-button'
import { I, PILL, SetupSheet } from '@/components/kit'
import { Field } from '@/features/connections/sheet'
import { appName, setupStage, slugOf } from '@/features/settings/github-setup'
import { Row, Rows } from '@/features/settings/kit'
import { fieldError, formError, request } from '@/lib/api-client'
import { open } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const KEY = ['github-app']
const OWNER = 'openhut.github.owner'
const PATH = '/api/github-app'
const POLL_MS = 1000
const AVATAR_DELAY_MS = 300
const CLOSED_EARLY = 'GitHub closed before it finished.'
export const STEADY = 'mt-[max(24px,calc(50vh-150px))] mb-auto'
const CLOSED_GRACE_MS = 4000
const SIZES: Record<number, string> = { 20: 'size-5', 24: 'size-6', 28: 'size-7' }

export type Sheet = Pick<ComponentProps<typeof SetupSheet>, 'className' | 'icon' | 'title' | 'blurb' | 'safe' | 'error' | 'foot' | 'onSubmit' | 'children'>

export function useGithubApp({ live = false }: { live?: boolean } = {}) {
  return useQuery({ queryKey: KEY, queryFn: () => request({ schema: GithubAppInfo, path: PATH }), refetchInterval: live ? POLL_MS : false })
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
  return <Row icon={<Glyph name="github" size={20} />} title="GitHub" note={app ? `${app.slug}[bot] · on ${app.owner}${repos(app.repositories, ' · ')}` : `Not set up · Agents open pull requests as your team’s bot${asked}`}>
    <Button type="button" variant="ghost" className={PILL} onClick={() => open('github')}>{app ? 'Manage' : 'Set up'}</Button>
  </Row>
}

export function GitHubDialogs({ opened }: { opened: string | null }) {
  const info = useGithubApp().data
  if (!info || opened !== 'github') return null
  return <GitHubDialog onClose={() => open()} />
}

function GitHubDialog({ onClose }: { onClose: () => void }) {
  return <SetupSheet modal brand="github" className={STEADY} onClose={onClose} {...useGithubSetup({ onClose }).sheet} />
}

function repos(count: number | null, before: string): string {
  if (count === null) return ''
  return `${before}${count} ${count === 1 ? 'repository' : 'repositories'}`
}

export function Avatar({ url, name, org, size = 24 }: { url: string; name: string; org: boolean; size?: number }) {
  const [broken, setBroken] = useState(false)
  const shape = org ? 'rounded-[5px]' : 'rounded-full'
  if (broken || !url) return <span className={cn(SIZES[size] ?? 'size-6', 'grid shrink-0 place-items-center bg-ink text-[11px] font-semibold text-card', shape)}>{name[0]?.toUpperCase()}</span>
  return <img src={url} alt="" width={size} height={size} onError={() => setBroken(true)} className={cn('shrink-0 object-cover shadow-[0_0_0_1px_var(--hair)]', shape)} />
}

function remembered(): string {
  try { return localStorage.getItem(OWNER) ?? '' } catch { return '' }
}

function remember(owner: string): void {
  try { localStorage.setItem(OWNER, owner) } catch { return }
}

function useSettled(value: string): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), AVATAR_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value])
  return settled
}

const Skeleton = ({ className }: { className: string }) => <i aria-hidden className={cn('block shrink-0 animate-pulse bg-soft', className)} />

function Status({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <Rows><Row icon={icon} title={children} /></Rows>
}

export function useGithubSetup({ onClose, onDone }: { onClose: () => void; onDone?: () => void }): { started: boolean; sheet: Sheet } {
  const [started, setStarted] = useState(false)
  const [owner, setOwner] = useState(remembered)
  const [named, setNamed] = useState<string>()
  const [blocked, setBlocked] = useState<string>()
  const [lost, setLost] = useState(false)
  const tab = useRef<Window | null>(null)
  const query = useGithubApp({ live: started })
  const app = query.data?.app
  const stage = setupStage({ started, app })
  const login = owner.trim()
  const avatarOf = useSettled(login)
  const name = named ?? appName({ owner: login, host: location.hostname })
  const remove = useGithubAppChange(() => request({ schema: GithubAppInfo, path: PATH, method: 'DELETE' }))
  const go = (url: string) => {
    if (tab.current && !tab.current.closed) tab.current.location.href = url
    else setBlocked(url)
  }
  const create = useMutation({
    mutationFn: (body: CreateGithubApp) => request({ schema: GithubAppLaunch, path: PATH, method: 'POST', body }),
    onSuccess: ({ url }) => go(url),
    onError: () => {
      tab.current?.close()
      setStarted(false)
    },
  })
  const start = () => {
    tab.current = window.open('', 'openhut-github', 'popup,width=1020,height=780')
    setLost(false)
    setBlocked(undefined)
    setStarted(true)
    if (app) return go(app.installUrl)
    remember(login)
    create.mutate({ ...login && { owner: login }, name: name.trim() })
  }
  useEffect(() => {
    if (stage !== 'done') return
    tab.current?.close()
    onDone?.()
  }, [stage])
  useEffect(() => {
    if (!started || stage === 'done') return
    let closedAt = 0
    const timer = setInterval(() => {
      if (!tab.current?.closed) return
      if (!closedAt) void query.refetch()
      closedAt ||= Date.now()
      if (Date.now() - closedAt > CLOSED_GRACE_MS) setLost(true)
    }, 500)
    return () => clearInterval(timer)
  }, [started, stage])
  const cancel = () => {
    tab.current?.close()
    onClose()
  }
  const primary = (label: string) => <Button type="button" variant="primary" onClick={start}>{label}</Button>
  const openGithub = (url: string) => <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'primary' })} onClick={() => setBlocked(undefined)}>Open GitHub</a>
  const following = () => {
    if (lost) return primary('Try again')
    if (blocked) return openGithub(blocked)
    return <Button type="button" variant="secondary" onClick={() => tab.current?.focus()}>Show GitHub</Button>
  }
  const pending = <Skeleton className="size-5 rounded-full" />
  const idle = <I icon={CircleIcon} size={20} className="text-mute-2" />
  if (stage === 'form') return {
    started,
    sheet: {
      title: 'Set up GitHub',
      blurb: `Agents open pull requests as ${slugOf(name) || 'your bot'}[bot].`,
      error: formError(create.error, ['name', 'owner']),
      safe: 'GitHub opens in a small window.',
      onSubmit: (event) => {
        event.preventDefault()
        start()
      },
      foot: <><Button type="button" variant="secondary" onClick={cancel}>Cancel</Button><Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>Continue on GitHub</Button></>,
      children: <>
        <Field label="Owner" error={fieldError(create.error, 'owner')}>
          <span className="relative flex items-center">
            <span className="pointer-events-none absolute left-2 flex">{avatarOf ? <Avatar key={avatarOf} url={`https://avatars.githubusercontent.com/${encodeURIComponent(avatarOf)}?s=40`} name={avatarOf} org size={20} /> : <Glyph name="github" size={20} />}</span>
            <Input mono value={owner} className="pl-9" onInput={(event) => setOwner(event.currentTarget.value)} placeholder="Your account" aria-label="Owner" autoComplete="off" spellCheck={false} autoFocus />
          </span>
        </Field>
        <Field label="Name" error={fieldError(create.error, 'name')}>
          <Input mono value={name} maxLength={34} onInput={(event) => setNamed(event.currentTarget.value)} aria-label="Name" autoComplete="off" spellCheck={false} />
        </Field>
      </>,
    },
  }
  if (!app) return {
    started,
    sheet: {
      icon: <Skeleton className="size-7 rounded-[6px]" />,
      title: `${slugOf(name)}[bot]`,
      blurb: `on ${login || 'your account'}`,
      safe: blocked && !lost ? 'Your browser blocked the window.' : undefined,
      foot: following(),
      children: lost ? <Status icon={idle}>{CLOSED_EARLY}</Status> : <Status icon={pending}>Creating app…</Status>,
    },
  }
  const installed = stage === 'done' || (!started && !!app.repositories)
  const live = started && !installed
  const line = () => {
    if (installed) return <Status icon={<I icon={CheckmarkCircle02Icon} size={20} className="text-hue-green" />}><a href={app.installUrl} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">Installed on {repos(app.repositories, '')}</a></Status>
    if (live && !lost) return <Status icon={pending}>Installing…</Status>
    if (lost) return <Status icon={idle}>{CLOSED_EARLY}</Status>
    return <Status icon={idle}>{app.repositories === null ? 'GitHub didn’t answer' : 'Not installed yet'}</Status>
  }
  const action = () => {
    if (live) return following()
    if (!installed) return primary('Install on GitHub')
  }
  return {
    started,
    sheet: {
      icon: <Avatar url={app.avatarUrl} name={app.slug} org size={28} />,
      title: `${app.slug}[bot]`,
      blurb: `on ${app.owner}`,
      safe: live ? (blocked && !lost ? 'Your browser blocked the window.' : undefined) : <ConfirmButton variant="danger" size="sm" question="Remove GitHub?" detail="Agents lose access to GitHub." action="Remove"
        onConfirm={() => remove.mutateAsync(undefined).then(onClose)}>Remove</ConfirmButton>,
      foot: <><a href={app.settingsUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center text-[12.5px] text-mute no-underline hover:text-ink hover:underline">Add an avatar on GitHub</a>{action()}</>,
      children: line(),
    },
  }
}
