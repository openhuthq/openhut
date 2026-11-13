import type { Admin } from '@fastmonkey/common/admin/admin.ts'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/field'
import { ICONS } from '@/components/icons'
import { useUpdateAdmin } from '@/features/admin/api'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

const APIS = ['gmail', 'drive', 'docs', 'sheets', 'slides', 'calendar-json'].flatMap((api) => [`${api}.googleapis.com`, `${api.replace('-json', '')}mcp.googleapis.com`])
const ENABLE_URL = `https://console.cloud.google.com/flows/enableapi?apiid=${APIS.join(',')}`
const CLIENT_URL = 'https://console.cloud.google.com/auth/clients/create'
const FIELDS = ['googleClientId', 'googleClientSecret']

export function GoogleClientSetup({ admin, back }: { admin: Admin; back: string }) {
  const updateAdmin = useUpdateAdmin(back)
  return <form className="cform" id="google-client" onSubmit={(event) => {
    const field = formValues(event)
    updateAdmin.mutate({ googleClientId: field('googleClientId'), googleClientSecret: field('googleClientSecret') })
  }}>
    <div className="setup-acts">
      <a className="btn sec sm" href={CLIENT_URL} target="_blank" rel="noreferrer" title="Type Web application; consent screen Internal">{ICONS.ext}Create a web client</a>
      <CopyButton text={admin.google.redirectUri} label="Copy redirect URL" />
      <a className="btn sec sm" href={ENABLE_URL} target="_blank" rel="noreferrer">{ICONS.ext}Enable the APIs</a>
    </div>
    <div className="setup-two">
      <Field label="Client ID" error={fieldError(updateAdmin.error, 'googleClientId')}>{(control) =>
        <input {...control} name="googleClientId" className="mono" required placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" />}</Field>
      <Field label="Client secret" error={fieldError(updateAdmin.error, 'googleClientSecret')}>{(control) =>
        <input {...control} name="googleClientSecret" type="password" className="mono" required minLength={10} placeholder="GOCSPX-…" autoComplete="off" />}</Field>
    </div>
    {formError(updateAdmin.error, FIELDS) && <span className="ferr" role="alert">{formError(updateAdmin.error, FIELDS)}</span>}
    <div><button className="btn sec sm" disabled={updateAdmin.isPending}>Save the client</button></div>
  </form>
}
