import { useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { Button, buttonVariants } from '@/components/ui/button'
import { isBrand, type BrandName } from '@/components/brand-icons'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { Loading } from '@/components/kit'
import { CardReply } from '@/features/threads/card'
import { Field } from '@/features/webhooks/webhooks-dialog'
import { request } from '@/lib/api-client'

export const WebhookSetup = z.object({
  webhookId: z.string(),
  title: z.string(),
  steps: z.array(z.string()),
  openUrl: z.optional(z.string()),
})
export type WebhookSetup = z.infer<typeof WebhookSetup>

const SetupValues = z.object({ address: z.string(), secret: z.string() })

export function WebhookSetupCard({ agentId, card }: { agentId: string; card: WebhookSetup }) {
  const reply = useContext(CardReply)
  const values = useQuery({
    queryKey: ['webhooks', agentId, card.webhookId, 'setup'],
    queryFn: () => request({ schema: SetupValues, of: agentId, path: `/api/agents/${encodeURIComponent(agentId)}/webhooks/${encodeURIComponent(card.webhookId)}/setup` }),
    staleTime: Infinity,
  })
  const brand = brandOf(card.openUrl)
  return <div className="flex max-w-[560px] min-w-0 flex-col gap-3.5 rounded-xl bg-sidebar p-4">
    <div className="flex min-w-0 items-center gap-3">
      {brand && <span className="grid size-8 shrink-0 place-items-center"><Glyph name={brand} size={22} /></span>}
      <div className="min-w-0 text-[14px]/[20px] font-medium text-ink">{card.title}</div>
    </div>
    <ErrorNote message={values.error?.message} />
    {!values.data && !values.error && <Loading />}
    {values.data && <div className="flex flex-col gap-1">
      <Field label="Address"><code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={values.data.address}>{values.data.address}</code><CopyButton text={values.data.address} label="Copy" variant="ghost" /></Field>
      <Field label="Secret"><code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{`${values.data.secret.slice(0, 6)}••••••••${values.data.secret.slice(-4)}`}</code><CopyButton text={values.data.secret} label="Copy secret" variant="ghost" /></Field>
    </div>}
    {card.steps.length > 0 && <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[13.5px]/[1.5] text-ink marker:text-mute">{card.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    <div className="flex flex-wrap gap-2">
      {card.openUrl && <a href={card.openUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open {brandWord(card.openUrl)}<span className="text-[11px] text-mute">↗</span></a>}
      <Button type="button" variant="primary" size="sm" disabled={!values.data} onClick={() => reply(`Done: ${card.title}`)}>Done</Button>
    </div>
  </div>
}

const WORDS: Partial<Record<BrandName, string>> = { digitalocean: 'DigitalOcean', cloudflare: 'Cloudflare', github: 'GitHub' }

function brandOf(url: string | undefined): BrandName | undefined {
  const host = url && URL.canParse(url) ? new URL(url).hostname : ''
  return host.split('.').find(isBrand)
}

function brandWord(url: string): string {
  const brand = brandOf(url)
  return (brand && WORDS[brand]) ?? new URL(url).hostname
}
