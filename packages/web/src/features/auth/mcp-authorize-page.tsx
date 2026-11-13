import type { Me } from '@fastmonkey/common/team/team.ts'
import { NAV_ICONS } from '@/components/icons'
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
    <div className="authform">
      <div><h1>{`Connect ${name} to Fast Monkey?`}</h1><p className="lead">{`It acts as you, ${me.user.username}, and can:`}</p></div>
      <div className="box rows">{ABILITIES.map(([section, actions]) => <div className="row" key={section}>{NAV_ICONS[section]}<div className="t">{section} <span className="mute">{actions}</span></div></div>)}</div>
      {problem && <p className="err" role="alert">{problem}</p>}
      {!problem && <div className="twobtn">
        <button type="button" className="btn sec" disabled={createCode.isPending || !oauthClient.data} onClick={() => createCode.mutate({ ...ask, allow: false })}>Deny</button>
        <button type="button" className="btn primary" disabled={createCode.isPending || !oauthClient.data} onClick={() => createCode.mutate({ ...ask, allow: true })}>Allow</button>
      </div>}
    </div>
  </AuthLayout>
}

function Answered({ name, allowed }: { name: string; allowed: boolean }) {
  return <AuthLayout title="Connect an app">
    <div className="authform">
      <div><h1>{allowed ? `${name} is connected` : 'Not connected'}</h1><p className="lead">Go back to the app. You can close this tab.</p></div>
    </div>
  </AuthLayout>
}
