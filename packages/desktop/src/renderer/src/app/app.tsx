import { useRef } from 'react'
import { ErrorNote } from '@/components/error-note'
import { routeOf } from '@/app/routes'
import { Shell, type ShellRoute } from '@/app/shell'
import { BrowserPage } from '@/features/agents/browser-page'
import { ConnectionsView } from '@/features/connections/connections-view'
import { FirstRun } from '@/features/first-run/first-run'
import { useMe } from '@/features/people/api'
import { SettingsView } from '@/features/settings/settings-view'
import { navigate, usePath } from '@/lib/router'

type Background = { path: string; route: ShellRoute }

export function App() {
  const path = usePath()
  const route = routeOf(path)
  const background = useRef<Background>({ path: '/', route: { page: 'home', adding: false } })
  if (route.page === 'home' || route.page === 'agent') background.current = { path, route }
  const me = useMe()
  if (route.page === 'welcome') return <FirstRun />
  if (me.error) return <ErrorNote className="mx-6 mt-4" message={me.error.message} />
  if (!me.data) return null
  if (route.page === 'browser') return <BrowserPage me={me.data} agentId={route.agentId} />
  const close = () => navigate(background.current.path)
  return <>
    <Shell route={route.page === 'settings' || route.page === 'connections' ? background.current.route : route} overlay={route.page === 'settings' || route.page === 'connections' ? route.page : undefined} />
    {route.page === 'settings' && <SettingsView tab={route.tab} onClose={close} />}
    {route.page === 'connections' && <ConnectionsView onClose={close} />}
  </>
}
