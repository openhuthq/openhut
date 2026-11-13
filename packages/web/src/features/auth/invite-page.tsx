import { useCreatePerson, useInviteLink } from '@/features/auth/api'
import { AuthForm } from '@/features/auth/auth-form'
import { AuthLayout } from '@/features/auth/auth-layout'
import { CredentialFields } from '@/features/auth/credential-fields'
import { RequestError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { ROLE_WITH_ARTICLE } from '@/lib/roles'

export function InvitePage({ token }: { token: string }) {
  const inviteLink = useInviteLink(token)
  const createPerson = useCreatePerson()
  if (inviteLink.error instanceof RequestError && inviteLink.error.status === 410) return <InviteGone />
  if (inviteLink.isPending) return null
  const role = inviteLink.data ? ROLE_WITH_ARTICLE[inviteLink.data.role] : 'a teammate'
  return <AuthForm title="Join Fast Monkey" heading="Join Fast Monkey" lead={`You're invited as ${role}. Enter your email and pick a password.`} error={inviteLink.error ?? createPerson.error}
    fields={['email', 'password']} busy={createPerson.isPending} button="Join" foot="This link works once."
    onSubmit={(event) => {
      const field = formValues(event)
      createPerson.mutate({ inviteToken: token, email: field('email'), password: field('password') })
    }}>
    <CredentialFields error={createPerson.error} />
  </AuthForm>
}

function InviteGone() {
  return <AuthLayout title="Invite expired">
    <div className="authform">
      <div><h1>This invite doesn't work anymore</h1><p className="lead">It was already used, or it's older than 7 days. Ask whoever sent it for a new one.</p></div>
      <a className="btn primary" href="/login">Sign in instead</a>
    </div>
  </AuthLayout>
}
