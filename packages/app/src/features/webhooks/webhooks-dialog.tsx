import type { ReactNode } from 'react'
import { Cancel01Icon, Delete02Icon, RefreshIcon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { CopyButton } from '@/components/copy-button'
import { useConfirming } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I, Loading, TINY_ICON } from '@/components/kit'
import { Details, Quiet } from '@/features/agents/request-card'
import { PlacePicker } from '@/features/agents/notify'
import { SOFT_TRIGGER } from '@/features/models/model-picker'
import { PreviewCard } from '@/features/webhooks/call-card'
import { pretty } from '@/features/webhooks/call'
import { useCreateWebhook, useDeleteWebhook, useRotateWebhook, useUpdateWebhook, useWebhooks, type Webhook } from '@/features/webhooks/api'
import { ago } from '@/lib/format'
import { formValues } from '@/lib/form'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function WebhooksDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const webhooks = useWebhooks(agent.id)
  const create = useCreateWebhook(agent.id)
  return <DialogCard onClose={onClose} className="max-h-[min(680px,calc(100vh-48px))] w-[560px] gap-0 overflow-hidden p-0">
    <div className="flex items-center gap-3 px-6 pt-6 pb-4">
      <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">Webhooks</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mr-2" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-6 pb-4">
      <ErrorNote message={webhooks.error?.message} />
      {!webhooks.data && !webhooks.error && <Loading />}
      {webhooks.data && (webhooks.data.length
        ? webhooks.data.map((webhook) => <WebhookItem key={webhook.id} agent={agent} webhook={webhook} />)
        : <Quiet agent={agent} line={`No webhooks yet. Add one here, or ask ${agent.name} for one.`} />)}
    </div>
    <form className="flex items-center gap-2 border-t border-hair px-6 py-4" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget
      create.mutate({ name: formValues(event)('name') }, { onSuccess: () => form.reset() })
    }}>
      <Input name="name" aria-label="Webhook name" placeholder="What calls it, like DigitalOcean alerts" maxLength={60} required className="flex-1" />
      <Button type="submit" variant="primary" disabled={create.isPending}>Add webhook</Button>
    </form>
    {create.error && <ErrorNote className="mx-6 mb-4" message={create.error.message} />}
  </DialogCard>
}

function WebhookItem({ agent, webhook }: { agent: Agent; webhook: Webhook }) {
  const update = useUpdateWebhook(agent.id)
  const rotate = useRotateWebhook(agent.id)
  const remove = useDeleteWebhook(agent.id)
  const { confirming, setConfirming, box } = useConfirming()
  return <section ref={box} className="flex flex-col gap-3 rounded-xl bg-sidebar p-4">
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{webhook.name}</span>
      <span className="shrink-0 text-[12px] text-mute">{webhook.lastAt ? `Last called ${ago(webhook.lastAt)} ago` : 'Not called yet'}</span>
      {!confirming && <Tooltip label="Delete webhook"><Button type="button" variant="bare" className={cn(TINY_ICON, 'text-fail')} aria-label={`Delete ${webhook.name}`} onClick={() => setConfirming(true)}><I icon={Delete02Icon} size={15} /></Button></Tooltip>}
    </div>
    <Field label="Address"><code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={webhook.url}>{webhook.url}</code><CopyButton text={webhook.url} label="Copy" variant="ghost" /></Field>
    <Field label="Secret"><code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{`${webhook.secret.slice(0, 6)}••••••••${webhook.secret.slice(-4)}`}</code>
      <CopyButton text={webhook.secret} label="Copy" variant="ghost" />
      <Button type="button" variant="ghost" size="sm" disabled={rotate.isPending} onClick={() => rotate.mutate(webhook.id, { onError: toastError })}><I icon={RefreshIcon} size={13} className="text-hue-amber" />New secret</Button>
    </Field>
    <Field label="Runs in"><PlacePicker agentId={agent.id} value={webhook.channel === 'app' ? null : webhook.channel ?? null} none="Here in the web app" label="Runs in" className="w-[260px]" disabled={update.isPending} onPick={(place) => update.mutate({ id: webhook.id, channel: place ?? 'app' }, { onError: toastError })} /></Field>
    <Field label="Threads"><ThreadsPicker value={webhook.threads} disabled={update.isPending} onPick={(threads) => update.mutate({ id: webhook.id, threads }, { onError: toastError })} /></Field>
    {webhook.filter && <div className="flex min-w-0 items-start gap-2 text-[13px]"><span className="w-16 shrink-0 pt-1.5 text-mute">Wakes on</span>
      <span className="grid min-w-0 flex-1 gap-1.5"><code className="rounded-md bg-soft px-2 py-1.5 font-mono text-[12px]/[1.5] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{webhook.filter}</code>
        {Boolean(webhook.skipped) && <span className="text-[12.5px] text-mute">{webhook.skipped} skipped since the last wake</span>}</span>
    </div>}
    {(webhook.lastPayload !== null || webhook.preview) && <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">{webhook.lastPayload !== null && <Details label="Last call"><pre className="m-0 max-h-56 overflow-auto font-mono text-[11.5px]/[1.5] whitespace-pre-wrap text-ink">{pretty(webhook.lastPayload)}</pre></Details>}</div>
      {webhook.preview && <PreviewCard card={webhook.preview} name={webhook.name} />}
    </div>}
    {confirming && <div className="flex items-center gap-2 text-[13px]">
      <span>Calls to this address stop reaching {agent.name}.</span>
      <span className="ml-auto flex gap-2"><Button type="button" variant="secondary" size="sm" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
        <Button type="button" variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(webhook.id, { onError: toastError })}>Delete</Button></span>
    </div>}
  </section>
}

type Threads = Webhook['threads']

const THREADS: Record<Threads, { name: string; note: string }> = {
  group: { name: 'Keep related together', note: 'An alert and its recovery share a thread' },
  each: { name: 'New thread each call', note: 'For forms, orders, signups' },
}

function ThreadsPicker({ value, disabled, onPick }: { value: Threads; disabled: boolean; onPick: (threads: Threads) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger className={cn(SOFT_TRIGGER, 'w-[260px] gap-2')} disabled={disabled} aria-label={`Threads: ${THREADS[value].name}`}>
      <span className="min-w-0 flex-1 truncate text-left">{THREADS[value].name}</span>
      <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      {(['group', 'each'] as const).map((each) => <DropdownMenuItem key={each} size="tall" className="items-start py-2 pr-4 text-[13px]" onClick={() => each !== value && onPick(each)}>
        <span className="grid h-[18px] w-3.5 shrink-0 place-items-center">{each === value && <I icon={Tick02Icon} size={14} className="text-ink" />}</span>
        <span className="grid min-w-0 gap-px"><span className="truncate text-ink">{THREADS[each].name}</span><span className="truncate text-[12px] text-mute">{THREADS[each].note}</span></span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-h-8 min-w-0 items-center gap-2 text-[13px]"><span className="w-16 shrink-0 text-mute">{label}</span>{children}</div>
}

