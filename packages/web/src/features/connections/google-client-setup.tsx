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
    <ol className="substeps">
      <li>In Google Cloud, create an OAuth client of type <b>Web application</b>. On the consent screen, pick <b>Internal</b> so only your Workspace can sign in.
        <div><a className="btn sec sm" href={CLIENT_URL} target="_blank" rel="noreferrer">{ICONS.ext}Create the client</a></div></li>
      <li>Add this as its authorized redirect URI:<div><CopyButton text={admin.google.redirectUri} /></div></li>
      <li>Turn on the Workspace APIs and Google's MCP servers for them in the same project.
        <div><a className="btn sec sm" href={ENABLE_URL} target="_blank" rel="noreferrer">{ICONS.ext}Enable the APIs</a></div></li>
    </ol>
    <Field label="Client ID" error={fieldError(updateAdmin.error, 'googleClientId')}>{(control) =>
      <input {...control} name="googleClientId" className="mono" required placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" />}</Field>
    <Field label="Client secret" error={fieldError(updateAdmin.error, 'googleClientSecret')}>{(control) =>
      <input {...control} name="googleClientSecret" type="password" className="mono" required minLength={10} placeholder="GOCSPX-…" autoComplete="off" />}</Field>
    {formError(updateAdmin.error, FIELDS) && <span className="ferr" role="alert">{formError(updateAdmin.error, FIELDS)}</span>}
    <div><button className="btn sec" disabled={updateAdmin.isPending}>Save the client</button></div>
  </form>
}
