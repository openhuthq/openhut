import type { Me } from '@openhut/common/team/team.ts'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { ErrorNote } from '@/components/error-note'
import { NAV_ICONS } from '@/components/icons'
import { AuthHeading, AuthPanel } from '@/features/auth/auth-form'
import { useCreateOAuthCode, useOAuthClient } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/auth-layout'

const ABILITIES = [['agents', 'create, change, start, stop'], ['connections', 'add, share, grant'], ['people', 'invite, remove']] as const
const MISSING_REQUEST = 'This sign-in link is missing its request. Start the connection again from the app.'

export function McpAuthorizePage({ me }: { me: Me }) {
  const params = new URLSearchParams(location.search)
  const ask = {
    clientId: params.get('client_id') ?? '',
    redirectUri: params.get('redirect_uri') ?? '',
    codeChallenge: params.get('code_challenge') ?? '',
    codeChallengeMethod: params.get('code_challenge_method') ?? '',
    state: params.get('state') ?? undefined,
  }
  const oauthClient = useOAuthClient(ask.clientId)
  const createCode = useCreateOAuthCode()
  const name = oauthClient.data?.name ?? 'this app'
  if (createCode.isSuccess) return <Answered name={name} allowed={createCode.variables.allow} />
  const problem = params.get('response_type') === 'code' ? oauthClient.error?.message ?? createCode.error?.message : MISSING_REQUEST
  return <AuthLayout title="Connect an app">
    <AuthPanel>
      <AuthHeading heading={`Connect ${name}?`} lead={`It reaches OpenHut as you, ${me.user.email}, and can:`} />
      <ItemGroup>{ABILITIES.map(([section, actions]) => <Item key={section}>{NAV_ICONS[section]}<ItemContent>{section} <span className="text-mute">{actions}</span></ItemContent></Item>)}</ItemGroup>
      <ErrorNote message={problem} />
      {!problem && <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={createCode.isPending || !oauthClient.data} onClick={() => createCode.mutate({ ...ask, allow: false })}>Deny</Button>
        <Button type="button" variant="primary" size="lg" disabled={createCode.isPending || !oauthClient.data} onClick={() => createCode.mutate({ ...ask, allow: true })}>Allow</Button>
      </div>}
    </AuthPanel>
  </AuthLayout>
}

function Answered({ name, allowed }: { name: string; allowed: boolean }) {
  return <AuthLayout title="Connect an app">
    <AuthPanel>
      <AuthHeading heading={allowed ? `${name} is connected` : 'Not connected'} lead="Go back to the app. You can close this tab." />
    </AuthPanel>
  </AuthLayout>
}
