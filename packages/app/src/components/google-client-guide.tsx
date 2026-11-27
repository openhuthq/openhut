import type { ReactNode } from 'react'
import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { I, PILL } from '@/components/kit'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/sheet'
import { fieldError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const CLIENT_URL = 'https://console.cloud.google.com/auth/clients/create'
const APIS = ['gmail', 'drive', 'docs', 'sheets', 'slides', 'calendar-json', 'chat', 'people']
const ENABLE_URL = `https://console.cloud.google.com/flows/enableapi?apiid=${APIS.map((api) => `${api}.googleapis.com`).join(',')}`

export function GoogleClientGuide({ redirectUris, error, apis = false }: { redirectUris: string[]; error: Error | null; apis?: boolean }) {
  return <GuideSteps>
    <GuideStep n={1}>
      <span>In Google Cloud, create an OAuth client of type <b>Web application</b>. One client serves sign-in and the Google apps.</span>
      <div className="flex flex-wrap gap-1.5">
        <a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href={CLIENT_URL} target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Open Google Cloud</a>
        {apis && <a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href={ENABLE_URL} target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Turn on the APIs</a>}
      </div>
    </GuideStep>
    <GuideStep n={2}>
      <span>Under <b>Authorized redirect URIs</b>, add {redirectUris.length > 1 ? 'both URLs' : 'this URL'}.</span>
      {redirectUris.map((uri) => <div key={uri} className="flex items-center gap-2 rounded-lg bg-tint py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 py-1 font-mono text-[12px]/[1.6] break-all text-ink">{uri}</code>
        <CopyButton text={uri} label="Copy" variant="ghost" className={PILL} />
      </div>)}
    </GuideStep>
    <GuideStep n={3}>
      <span>Paste the client ID and secret Google shows you.</span>
      <div className="grid grid-cols-2 gap-2.5 phone:grid-cols-1">
        <Field label="Client ID" error={fieldError(error, 'googleClientId')}><Input mono name="clientId" required placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" /></Field>
        <Field label="Client secret" error={fieldError(error, 'googleClientSecret')}><Input mono name="clientSecret" type="password" required placeholder="GOCSPX-…" autoComplete="off" /></Field>
      </div>
    </GuideStep>
  </GuideSteps>
}

function GuideSteps({ children }: { children: ReactNode }) {
  return <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[12.5px]/[18px] text-body [&_b]:font-medium [&_b]:text-ink">{children}</ol>
}

function GuideStep({ n, children }: { n: number; children: ReactNode }) {
  return <li className="flex items-start gap-2.5">
    <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-soft text-[10.5px] font-semibold text-body">{n}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
  </li>
}
