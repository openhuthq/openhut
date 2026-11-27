import { useContext, useState } from 'react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { Button, buttonVariants } from '@/components/ui/button'
import { isBrand, type BrandName } from '@/components/brand-icons'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { I, Loading } from '@/components/kit'
import { CardReply } from '@/features/threads/card'
import { request } from '@/lib/api-client'

export const WebhookSetup = z.object({
  webhookId: z.string(),
  title: z.string(),
  steps: z.array(z.string()),
  openUrl: z.optional(z.string()),
})
export type WebhookSetup = z.infer<typeof WebhookSetup>

const SetupValues = z.object({ address: z.string(), secret: z.string() })

export const doneText = (card: WebhookSetup) => `Done: ${card.title}`

export function WebhookSetupCard({ agentId, card, done }: { agentId: string; card: WebhookSetup; done: boolean }) {
  const reply = useContext(CardReply)
  const [sent, setSent] = useState(false)
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
      <Value label="Address" shown={values.data.address} copy={values.data.address} action="Copy" />
      <Value label="Secret" shown={`${values.data.secret.slice(0, 6)}••••••••${values.data.secret.slice(-4)}`} copy={values.data.secret} action="Copy secret" />
    </div>}
    {card.steps.length > 0 && <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[13.5px]/[1.5] text-ink marker:text-mute">{card.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    <div className="flex flex-wrap gap-2">
      {card.openUrl && <a href={card.openUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open {brandWord(card.openUrl)}<span className="text-[11px] text-mute">↗</span></a>}
      {done || sent
        ? <span className="inline-flex items-center gap-1.5 text-[13px] text-ink"><I icon={CheckmarkCircle02Icon} size={16} className="animate-[pop_.45s_cubic-bezier(.2,.8,.2,1)] text-hue-green" />Done</span>
        : <Button type="button" variant="primary" size="sm" disabled={!values.data || !reply} onClick={() => setSent(!!reply?.(doneText(card)))}>Done</Button>}
    </div>
  </div>
}

function Value({ label, shown, copy, action }: { label: string; shown: string; copy: string; action: string }) {
  return <div className="flex min-h-8 min-w-0 items-center gap-2 text-[13px] phone:flex-wrap phone:gap-y-1 phone:py-1">
    <span className="w-16 shrink-0 text-mute">{label}</span>
    <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink phone:basis-full phone:whitespace-normal phone:[overflow-wrap:anywhere]">{shown}</code>
    <CopyButton text={copy} label={action} variant="ghost" className="phone:-ml-2.5" />
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
