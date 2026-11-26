import { createContext, useContext } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createRenderer } from '@json-render/react'
import { cardCatalog } from '@openhut/common/cards/card.ts'
import { askedPath } from '@openhut/common/asks/ask.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isBrand } from '@/components/brand-icons'
import { Glyph } from '@/components/glyph'
import { StatusBadge } from '@/components/status-badge'
import { integration } from '@/features/connections/catalog'
import { useGrants } from '@/features/agents/api'
import { useConnections } from '@/features/connections/api'
import { I } from '@/components/kit'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'

export const CardReply = createContext<(text: string) => void>(() => undefined)

const VARIANTS = { primary: 'primary', danger: 'destructive' } as const

export const MessageCard = createRenderer(cardCatalog, {
  Card: ({ element: { props }, children }) => {
    const brand = props.brand && isBrand(props.brand) ? props.brand : undefined
    const subtitle = props.subtitle ?? (brand && integration(brand)?.short)
    return <div className="flex max-w-[560px] min-w-0 flex-col gap-3.5 rounded-xl bg-sidebar p-4">
    <div className="flex min-w-0 items-center gap-3">
      {brand && <span className="grid size-8 shrink-0 place-items-center"><Glyph name={brand} size={22} /></span>}
      <div className="min-w-0">
        <div className="text-[14px]/[20px] font-medium text-ink">{props.title}</div>
        {subtitle && <div className="truncate text-[13px] text-mute">{subtitle}</div>}
      </div>
    </div>
    {children}
  </div>
  },
  Text: ({ element: { props } }) => <div className="msg-t"><Markdown remarkPlugins={[remarkGfm]}>{props.content}</Markdown></div>,
  Fields: ({ children }) => <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-4 gap-y-2.5">{children}</dl>,
  Field: ({ element: { props } }) => <div className="min-w-0">
    <dt className="text-[12px] text-mute">{props.label}</dt>
    <dd className="m-0 text-[13.5px] text-ink [overflow-wrap:anywhere]">{props.value}</dd>
  </div>,
  Table: ({ element: { props } }) => <div className="overflow-x-auto">
    <table className="w-full border-collapse text-[13px] tabular-nums">
      <thead><tr>{props.headers.map((header, i) => <th key={i} className="border-b border-hair px-2 py-1.5 text-left font-medium text-mute">{header}</th>)}</tr></thead>
      <tbody>{props.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className="border-b border-hair px-2 py-1.5 text-ink">{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>,
  Chart: ({ element: { props } }) => {
    const top = Math.max(...props.values.map(Math.abs), 1)
    return <figure className="m-0 flex flex-col gap-1.5">
      <figcaption className="text-[12.5px] font-medium text-ink">{props.title}</figcaption>
      {props.labels.map((label, i) => <div key={i} className="grid grid-cols-[minmax(0,90px)_1fr_auto] items-center gap-2 text-[12.5px]">
        <span className="truncate text-mute">{label}</span>
        <span className="flex h-2.5">
          <span className="rounded-sm bg-primary" style={{ flexGrow: Math.abs(props.values[i] ?? 0) }} />
          <span style={{ flexGrow: top - Math.abs(props.values[i] ?? 0) }} />
        </span>
        <span className="text-ink tabular-nums">{props.values[i]}</span>
      </div>)}
    </figure>
  },
  Image: ({ element: { props } }) => <img src={props.url} alt={props.alt} className="max-w-full rounded-md" />,
  Divider: () => <hr className="m-0 border-0 border-t border-hair" />,
  Actions: ({ children }) => <div className="flex flex-wrap gap-2">{children}</div>,
  Button: ({ element: { props } }) => {
    const reply = useContext(CardReply)
    return <Button type="button" size="sm" variant={props.style ? VARIANTS[props.style] : 'secondary'} onClick={() => reply(props.label)}>{props.label}</Button>
  },
  LinkButton: ({ element: { props } }) => {
    const inApp = askedPath(props.url)
    if (inApp) return <a href={inApp} className={cn(buttonVariants({ variant: 'text' }), 'ml-auto')}>{props.label}</a>
    return <a href={props.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>{props.label}<span className="text-[11px] text-mute">↗</span></a>
  },
  Connect: ({ element: { props } }) => {
    const brand = props.brand && isBrand(props.brand) ? props.brand : undefined
    const inApp = askedPath(props.url)
    const done = useConnected(inApp)
    return <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-6 shrink-0 place-items-center">{brand && <Glyph name={brand} size={20} />}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px]"><span className="text-ink">{props.title}</span>{props.subtitle && <span className="text-mute"> · {props.subtitle}</span>}</span>
      {done?.status === 'failing' && <StatusBadge status="failing" />}
      {done && done.status !== 'failing' && <span className="inline-flex h-7 items-center gap-1.5 text-[13px] text-ink"><I icon={CheckmarkCircle02Icon} size={16} className="animate-[pop_.45s_cubic-bezier(.2,.8,.2,1)] text-hue-green" />Connected</span>}
      {!done && <a href={inApp ?? props.url} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Connect</a>}
    </div>
  },
})

function useConnected(path: string | undefined): Connection | undefined {
  const [, kind = '', query = ''] = (path && /^\/connections\/new\/([a-z_]+)\?(.*)$/.exec(path)) || []
  const wanted = new URLSearchParams(query)
  const url = wanted.get('url')
  const host = url && URL.canParse(url) ? new URL(url).host : undefined
  const grants = useGrants({ agentId: wanted.get('for') ?? '' }).data ?? []
  const connections = useConnections().data ?? []
  return connections.find((connection) => grants.some((grant) => grant.connectionId === connection.id) && connection.kind === kind && (kind !== 'mcp' || connection.account.split(' · ')[0] === host))
}
