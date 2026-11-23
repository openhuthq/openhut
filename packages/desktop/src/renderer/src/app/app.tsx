import { useEffect, useRef } from 'react'
import { routeOf } from '@/app/routes'
import { Gate } from '@/app/gate'
import { Shell, type ShellRoute } from '@/app/shell'
import { useJoinRuntimes } from '@/features/cloud/live'
import { CloudToasts } from '@/features/cloud/unlock'
import { ConnectionsView } from '@/features/connections/connections-view'
import { CloudJoin, JoinLinkDialog } from '@/features/join/cloud-join'
import { Join } from '@/features/join/join'
import { useMe } from '@/features/people/api'
import { SettingsView } from '@/features/settings/settings-view'
import { isPhone, leave, onBack, update } from '@/lib/native'
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
  const close = () => navigate(background.current.path)
  return <Gate me={me}>
    {route.page === 'join' ? <CloudJoin /> : <>
      <Shell route={route.page === 'settings' || route.page === 'connections' ? background.current.route : route} overlay={route.page === 'settings' || route.page === 'connections' ? route.page : undefined} />
      {route.page === 'settings' && <SettingsView tab={route.tab} onClose={close} />}
      {route.page === 'connections' && <ConnectionsView onClose={close} />}
      {opened === 'join-link' && <JoinLinkDialog />}
    </>}
    <JoinRuntimes />
    <CloudToasts />
  </Gate>
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
