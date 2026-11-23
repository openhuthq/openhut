import { useEffect, useRef } from 'react'
import { ErrorNote } from '@/components/error-note'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { routeOf } from '@/app/routes'
import { Shell, type ShellRoute } from '@/app/shell'
import { useJoinRuntimes } from '@/features/cloud/live'
import { CloudGate } from '@/features/cloud/unlock'
import { CreateTeamDialog } from '@/features/agents/sidebar'
import { ConnectionsView } from '@/features/connections/connections-view'
import { FirstRun } from '@/features/first-run/first-run'
import { CloudJoin, JoinLinkDialog } from '@/features/join/cloud-join'
import { Join } from '@/features/join/join'
import { useMe } from '@/features/people/api'
import { SettingsView } from '@/features/settings/settings-view'
import { isPhone, leave, onBack, UnlockCanceled, update } from '@/lib/native'
import { usePhone } from '@/lib/phone'
import { navigate, open, useOpen, usePath } from '@/lib/router'

type Background = { path: string; route: ShellRoute }

export function App() {
  const phone = usePhone()
  if (!isPhone()) return <Dashboard />
  if (phone.status === 'loading') return null
  if (phone.status !== 'paired' || phone.link) return <Join removed={phone.status === 'removed'} link={phone.link} paired={phone.status === 'paired'} />
  return <Dashboard />
}

function Dashboard() {
  const path = usePath()
  const route = routeOf(path)
  const background = useRef<Background>({ path: '/', route: { page: 'home', adding: false } })
  if (route.page === 'home' || route.page === 'agent') background.current = { path, route }
  const me = useMe()
  const opened = useOpen()
  useEffect(() => onBack(back), [])
  useEffect(() => { void update() }, [])
  if (route.page === 'welcome') return <FirstRun />
  if (me.error) return <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-sidebar px-8 text-center">
    {me.error instanceof UnlockCanceled ? <p className="m-0 max-w-[280px] text-[15px] text-body">{me.error.message}</p> : <ErrorNote message={me.error instanceof DOMException ? 'OpenHut couldn\'t open a secure connection to your computer.' : me.error.message} />}
    <Button type="button" variant="secondary" disabled={me.isFetching} onClick={() => void me.refetch()}>{me.isFetching ? 'Trying…' : me.error instanceof UnlockCanceled ? 'Unlock' : 'Try again'}</Button>
  </div>
  if (!me.data) return <div className="grid h-dvh place-items-center bg-sidebar"><span className="animate-[fadein_.3s_1s_both]"><Spinner className="size-5" /></span></div>
  const close = () => navigate(background.current.path)
  if (route.page === 'join') return <CloudJoin />
  return <CloudGate>
    <Shell route={route.page === 'settings' || route.page === 'connections' ? background.current.route : route} overlay={route.page === 'settings' || route.page === 'connections' ? route.page : undefined} />
    {route.page === 'settings' && <SettingsView tab={route.tab} onClose={close} />}
    {route.page === 'connections' && <ConnectionsView onClose={close} />}
    <JoinRuntimes />
    {opened === 'join-link' && <JoinLinkDialog />}
    {opened === 'new-team' && <CreateTeamDialog />}
  </CloudGate>
}

function JoinRuntimes() {
  useJoinRuntimes()
  return null
}

function back() {
  const top = [...document.querySelectorAll<HTMLElement>('[role=menu], [role=dialog], [role=alertdialog]')].at(-1)
  const inner = top?.querySelector<HTMLElement>('[data-back]')
  if (inner?.checkVisibility()) return inner.click()
  if (top) return void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  if (new URLSearchParams(location.search).get('open')) return open()
  if (location.pathname === '/') return leave()
  navigate('/', true)
}
