import { lazy, Suspense, useRef } from 'react'
import { routeOf } from '@/app/routes'
import { Gate } from '@/app/gate'
import { Shell, type ShellRoute } from '@/app/layout/shell'
import { useMe } from '@/lib/queries/people'
import { navigate, Redirect, usePath } from '@/lib/router'
import { RequestError } from '@/lib/api-client'
import { InvitePage, ResetPage, SetupPage, SignInPage } from '@/features/auth/pages'

const SettingsView = lazy(() => import('@/app/routes/settings').then((module) => ({ default: module.SettingsView })))

type Background = { path: string; route: ShellRoute }

export function App() {
  const path = usePath()
  if (path === '/setup') return <SetupPage />
  if (path === '/login') return <SignInPage />
  if (path === '/reset') return <ResetPage />
  if (path.startsWith('/invite/')) return <InvitePage token={decodeURIComponent(path.slice('/invite/'.length))} />
  return <SignedIn path={path} />
}

function SignedIn({ path }: { path: string }) {
  const route = routeOf(path)
  const background = useRef<Background>({ path: '/', route: { page: 'home', adding: false } })
  if (route.page === 'home' || route.page === 'agent') background.current = { path, route }
  const me = useMe()
  const close = () => navigate(background.current.path)
  // One SettingsView for /settings/* and /connections, so moving to Apps swaps content instead of closing and reopening.
  const settings = route.page === 'settings' ? route.tab : route.page === 'connections' ? 'apps' : undefined
  if (route.page === 'settings' && route.tab === 'general') return <Redirect to="/settings/people" />
  if (me.error instanceof RequestError && me.error.status === 401) return <Redirect to="/login" />
  return <Gate me={me}>
    <Shell route={route.page === 'settings' || route.page === 'connections' ? background.current.route : route} overlay={route.page === 'settings' || route.page === 'connections' ? route.page : undefined} />
    {settings && <Suspense fallback={null}><SettingsView tab={settings} onClose={close} /></Suspense>}
  </Gate>
}
