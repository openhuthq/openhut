import { ErrorNote } from '@/components/error-note'
import { routeOf } from '@/app/routes'
import { SignedIn } from '@/app/signed-in'
import { BrowserPage } from '@/features/agents/browser-page'
import { nextPath, useMe, useSetup } from '@/features/auth/api'
import { InvitePage } from '@/features/auth/invite-page'
import { McpAuthorizePage } from '@/features/auth/mcp-authorize-page'
import { SetupPage } from '@/features/auth/setup-page'
import { SignInPage } from '@/features/auth/sign-in-page'
import { Redirect, usePath } from '@/lib/router'

export function App() {
  const route = routeOf(usePath())
  const me = useMe()
  const setup = useSetup(me.data === null)
  if (me.error) return <ErrorNote message={me.error.message} />
  if (me.data === undefined) return null
  switch (route.page) {
    case 'invite': return <InvitePage token={route.token} />
    case 'login': return me.data ? <Redirect to={nextPath()} /> : <SignInPage />
    case 'setup': return me.data ? <Redirect to="/agents" /> : <SetupPage />
  }
  if (!me.data) return setup.isPending ? null : <Redirect to={signInPath(setup.data?.open ?? false)} />
  if (route.page === 'mcp-authorize') return <McpAuthorizePage me={me.data} />
  if (route.page === 'browser') return <BrowserPage me={me.data} agentId={route.agentId} />
  return <SignedIn me={me.data} route={route} />
}

function signInPath(setupOpen: boolean) {
  if (setupOpen) return '/setup'
  const here = location.pathname + location.search
  if (here === '/') return '/login'
  return `/login?${new URLSearchParams({ next: here })}`
}
