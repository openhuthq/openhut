import { useEffect, useRef } from 'react'
import { ErrorNote } from '@/components/error-note'
import { routeOf } from '@/app/routes'
import { Shell, type ShellRoute } from '@/app/shell'
import { ConnectionsView } from '@/features/connections/connections-view'
import { FirstRun } from '@/features/first-run/first-run'
import { Join } from '@/features/join/join'
import { useMe } from '@/features/people/api'
import { SettingsView } from '@/features/settings/settings-view'
import { isPhone, leave, onBack, update } from '@/lib/native'
import { usePhone } from '@/lib/phone'
import { navigate, open, usePath } from '@/lib/router'

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
  useEffect(() => onBack(back), [])
  useEffect(() => { void update() }, [])
  if (route.page === 'welcome') return <FirstRun />
  if (me.error) return <ErrorNote className="mx-6 mt-[calc(16px+env(safe-area-inset-top))]" message={me.error.message} />
  if (!me.data) return null
  const close = () => navigate(background.current.path)
  return <>
    <Shell route={route.page === 'settings' || route.page === 'connections' ? background.current.route : route} overlay={route.page === 'settings' || route.page === 'connections' ? route.page : undefined} />
    {route.page === 'settings' && <SettingsView tab={route.tab} onClose={close} />}
    {route.page === 'connections' && <ConnectionsView onClose={close} />}
  </>
}

function back() {
  if (new URLSearchParams(location.search).get('open')) return open()
  if (location.pathname === '/') return leave()
  if (navigation.canGoBack) return navigation.back()
  navigate('/', true)
}
