import { useRef } from 'react'
import { routeOf } from '@/app/routes'
import { Gate } from '@/app/gate'
import { Shell, type ShellRoute } from '@/app/shell'
import { useJoinRuntimes } from '@/features/cloud/live'
import { CloudToasts } from '@/features/cloud/toasts'
import { CloudJoin, JoinLinkDialog } from '@/features/join/cloud-join'
import { useMe } from '@/features/people/api'
import { SettingsView } from '@/features/settings/settings-view'
import { navigate, useOpen, usePath } from '@/lib/router'

type Background = { path: string; route: ShellRoute }

export function App() {
  const path = usePath()
  const route = routeOf(path)
  const background = useRef<Background>({ path: '/', route: { page: 'home', adding: false } })
  if (route.page === 'home' || route.page === 'agent') background.current = { path, route }
  const me = useMe()
  const opened = useOpen()
  const close = () => navigate(background.current.path)
  // One SettingsView for /settings/* and /connections, so moving to Apps swaps content instead of closing and reopening.
  const settings = route.page === 'settings' ? route.tab : route.page === 'connections' ? 'apps' : undefined
  return <Gate me={me}>
    {route.page === 'join' ? <CloudJoin /> : <>
      <Shell route={route.page === 'settings' || route.page === 'connections' ? background.current.route : route} overlay={route.page === 'settings' || route.page === 'connections' ? route.page : undefined} />
      {settings && <SettingsView tab={settings} onClose={close} />}
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
