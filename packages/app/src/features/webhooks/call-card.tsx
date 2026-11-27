import { useState, type ReactNode } from 'react'
import { ArrowUpRight01Icon, ViewIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { I } from '@/components/kit'
import { cn } from '@/lib/utils'
import { brandColor, clockOf, initialsOf, payloadOf, statusLabel, tileOf, toneOf, type Call, type CallCard, type CallRow, type Tone } from '@/features/webhooks/call'

const TONE: Record<Tone, string> = {
  green: 'bg-tone-green-subtle text-tone-green',
  red: 'bg-tone-red-subtle text-tone-red',
  amber: 'bg-tone-amber-subtle text-tone-amber',
  grey: 'bg-soft text-mute',
}

const DOT: Record<Tone, string> = { green: 'bg-tone-green', red: 'bg-tone-red', amber: 'bg-tone-amber', grey: 'bg-mute-2' }

function Pill({ tone = 'grey', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px]/[16px] font-medium whitespace-nowrap', TONE[tone])}>
    {dot && <span className="size-1.5 rounded-full bg-current" />}{children}
  </span>
}

function Tile({ card, name }: { card: CallCard; name: string }) {
  const color = card.icon && brandColor(card.icon.hex)
  if (!card.icon || !color) return <span className="grid size-[30px] place-items-center rounded-lg bg-soft text-[11px] font-semibold text-body" aria-hidden>{initialsOf(name)}</span>
  return <span className="grid size-[30px] place-items-center rounded-lg" style={{ background: tileOf(color) }} aria-hidden>
    <svg viewBox="0 0 24 24" width={17} height={17}><path d={card.icon.path} fill={color} /></svg>
  </span>
}

export function CallCardBody({ card, name, seen, calls, children }: { card: CallCard; name: string; seen?: number; calls?: CallRow[]; children?: ReactNode }) {
  const many = calls && calls.length > 1 ? calls : undefined
  return <div className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3">
    <Tile card={card} name={name} />
    <div className="grid min-w-0 gap-1">
      <div className="flex min-h-[30px] items-center gap-2">
        <span className="min-w-0 flex-1 text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{card.title}</span>
        {many && <Pill>{many.length} calls</Pill>}
        {!many && (seen ?? 0) > 1 && <Pill>Seen {seen}×</Pill>}
        {card.status && <Pill tone={toneOf(card.status)} dot>{statusLabel(card.status)}</Pill>}
      </div>
      {card.details && <span className="text-[13px] text-mute [overflow-wrap:anywhere]">{card.details}</span>}
      {many && <div className="mt-1.5 grid w-fit grid-cols-[max-content_max-content_max-content] items-center gap-x-4 gap-y-1 border-l border-hair pl-2.5 text-[13px]">
        {many.map((row, index) => <CallLine key={index} row={row} />)}
      </div>}
      {children}
    </div>
  </div>
}

function CallLine({ row }: { row: CallRow }) {
  const tone = toneOf(row.status)
  return <>
    <span className="flex min-w-0 items-center gap-1.5 text-ink"><span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />{statusLabel(row.status)}{row.details && ` · ${row.details}`}</span>
    <span className="text-mute tabular-nums">{clockOf(row.at)}</span>
    <span>{row.seen && row.seen > 1 ? <Pill>Seen {row.seen}×</Pill> : null}</span>
  </>
}

export function CallCardMessage({ call, card, name, text }: { call: Call; card: CallCard; name: string; text: string }) {
  const [open, setOpen] = useState(false)
  return <div className="w-fit max-w-[440px] min-w-[280px] rounded-xl border border-hair bg-card px-3.5 py-3 text-[13.5px]/[1.5]">
    <CallCardBody card={card} name={name} seen={call.seen} calls={call.calls}>
      <span className="mt-1 flex flex-wrap items-center gap-x-3">
        {card.link && <a href={card.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[13.5px] text-ink no-underline hover:underline">Open run<I icon={ArrowUpRight01Icon} size={12} /></a>}
        <Button type="button" variant="bare" className="h-auto cursor-pointer p-0 text-[13.5px] text-mute underline underline-offset-2 hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide payload' : 'Show payload'}</Button>
      </span>
      {open && <pre className="m-0 mt-1 max-h-[320px] overflow-auto rounded-lg bg-soft p-3 font-mono text-[12px]/[1.5] whitespace-pre-wrap text-body">{payloadOf(text)}</pre>}
    </CallCardBody>
  </div>
}

export function PreviewCard({ card, name }: { card: CallCard; name: string }) {
  return <Popover>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" className="-my-1 shrink-0 text-body data-popup-open:bg-soft data-popup-open:text-ink" />}><I icon={ViewIcon} size={13} />Preview card</PopoverTrigger>
    <PopoverContent side="top" align="end" className="gap-2 px-3.5 py-3">
      <span className="text-[12px] text-mute">From the last call</span>
      <CallCardBody card={card} name={name} />
    </PopoverContent>
  </Popover>
}
