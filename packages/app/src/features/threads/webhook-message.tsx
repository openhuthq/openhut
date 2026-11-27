import * as z from 'zod/mini'
import { ArrowDown01Icon, ArrowUpRight01Icon, WebhookIcon } from '@hugeicons/core-free-icons'
import { summarizeWebhook, type WebhookSeverity } from '@openhut/common/webhooks/summary.ts'
import { buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { I } from '@/components/kit'
import { cn } from '@/lib/utils'
import { PayloadButton } from '@/components/call-card'

export const WebhookSource = z.object({ source: z.object({ kind: z.literal('webhook'), id: z.string(), name: z.string() }), payload: z.optional(z.unknown()) })
export type WebhookSource = z.infer<typeof WebhookSource>

export function webhookOf(metadata: unknown): WebhookSource | undefined {
  return z.safeParse(WebhookSource, metadata).data
}

export function CallText({ label, text }: { label?: string; text: string }) {
  return <span className="flex flex-wrap items-baseline gap-x-2"><span>{label || 'Webhook call'}</span><PayloadButton title={`${label || 'Webhook call'} payload`} text={text} /></span>
}

export function sizeOf(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

export function WebhookMessage({ webhook, at }: { webhook: WebhookSource; at?: string }) {
  const summary = summarizeWebhook(webhook.payload)
  const json = typeof webhook.payload === 'string' ? webhook.payload : JSON.stringify(webhook.payload, null, 2)
  return <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
    <span className="grid size-7 place-items-center rounded-lg bg-soft text-ink"><I icon={WebhookIcon} size={15} /></span>
    <div className="grid min-w-0 gap-1.5">
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-mute">
        <span className="truncate font-medium text-ink">{webhook.source.name}</span>
        <span className="shrink-0 rounded-md bg-soft px-1.5 py-px text-[11.5px] text-body">Webhook</span>
        {at && <span className="shrink-0">· {new Date(at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
      </span>
      <Collapsible className="flex max-w-[560px] flex-col gap-3 rounded-xl bg-sidebar px-4 py-3.5 text-[13.5px]">
        <div className="flex items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{summary.title}</span>
            {summary.subtitle && <span className="text-[12.5px] text-mute [overflow-wrap:anywhere]">{summary.subtitle}</span>}
          </div>
          {summary.severity && <span className={cn('shrink-0 text-[12.5px] font-medium', SEVERITY[summary.severity][1])}>{SEVERITY[summary.severity][0]}</span>}
        </div>
        {summary.fields.length > 0 && <dl className="m-0 grid grid-cols-3 gap-3 phone:grid-cols-2">
          {summary.fields.map((field) => <div key={field.label} className="grid min-w-0 gap-0.5">
            <dt className="truncate text-[12px] text-mute">{field.label}</dt>
            <dd className="m-0 truncate text-ink tabular-nums">{valueOf(field.value)}</dd>
          </div>)}
        </dl>}
        <div className="flex items-center gap-2">
          {summary.link && <a href={summary.link.url} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'bg-card hover:bg-hover')}>{summary.link.label}<I icon={ArrowUpRight01Icon} size={12} /></a>}
          <CollapsibleTrigger className="group/payload ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0.5 text-[12.5px] text-mute hover:text-ink">
            Payload · {sizeOf(json)}<I icon={ArrowDown01Icon} size={12} className="[transition:transform_.15s] group-data-panel-open/payload:rotate-180" />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent><pre className="m-0 max-h-[320px] overflow-auto rounded-lg bg-card p-3 font-mono text-[12px]/[1.5] text-body">{json}</pre></CollapsibleContent>
      </Collapsible>
    </div>
  </div>
}

export function valueOf(value: string): string {
  if (!ISO.test(value) || Number.isNaN(Date.parse(value))) return value
  return new Date(value).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const SEVERITY: Record<WebhookSeverity, [string, string]> = { critical: ['Critical', 'text-fail'], warning: ['Warning', 'text-warning-foreground'], info: ['Info', 'text-body'] }
