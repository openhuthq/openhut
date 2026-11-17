import type { Admin } from '@openhut/common/admin/admin.ts'
import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/features/connections/sheet'
import { useUpdateAdmin } from '@/features/settings/api'
import { I } from '@/components/kit'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

const APIS = ['gmail', 'drive', 'docs', 'sheets', 'slides', 'calendar-json'].flatMap((api) => [`${api}.googleapis.com`, `${api.replace('-json', '')}mcp.googleapis.com`])
const ENABLE_URL = `https://console.cloud.google.com/flows/enableapi?apiid=${APIS.join(',')}`
const CLIENT_URL = 'https://console.cloud.google.com/auth/clients/create'
const FIELDS = ['googleClientId', 'googleClientSecret']

export function GoogleClientSetup({ admin, onSaved }: { admin: Admin; onSaved: () => void }) {
  const updateAdmin = useUpdateAdmin()
  return <form className="flex flex-col gap-3" onSubmit={(event) => {
    const field = formValues(event)
    updateAdmin.mutate({ googleClientId: field('googleClientId'), googleClientSecret: field('googleClientSecret') }, { onSuccess: onSaved })
  }}>
    <p className="m-0 font-copy text-[12px]/[1.55] text-mute">Make a web client in Google Cloud: type <b className="font-medium text-body">Web application</b>, consent screen <b className="font-medium text-body">Internal</b>, with this redirect URL. Then turn on the APIs.</p>
    <div className="flex flex-wrap gap-1.5">
      <a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href={CLIENT_URL} target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={14} />Create a web client</a>
      <CopyButton text={admin.google.redirectUri} label="Copy redirect URL" />
      <a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href={ENABLE_URL} target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={14} />Enable the APIs</a>
    </div>
    <div className="grid grid-cols-2 gap-2.5">
      <Field label="Client ID" error={fieldError(updateAdmin.error, 'googleClientId')}><Input mono name="googleClientId" required placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" /></Field>
      <Field label="Client secret" error={fieldError(updateAdmin.error, 'googleClientSecret')}><Input mono name="googleClientSecret" type="password" required minLength={10} placeholder="GOCSPX-…" autoComplete="off" /></Field>
    </div>
    {formError(updateAdmin.error, FIELDS) && <FieldError>{formError(updateAdmin.error, FIELDS)}</FieldError>}
    <div><Button type="submit" variant="secondary" size="sm" disabled={updateAdmin.isPending}>Save the client</Button></div>
  </form>
}
