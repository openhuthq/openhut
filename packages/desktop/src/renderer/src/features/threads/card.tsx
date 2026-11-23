import { createContext, useContext } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createRenderer } from '@json-render/react'
import { cardCatalog } from '@openhut/common/cards/card.ts'
import { askedPath } from '@openhut/common/asks/ask.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { isBrand } from '@/components/brand-icons'
import { Glyph } from '@/components/glyph'
import { integration } from '@/features/connections/catalog'

export const CardReply = createContext<(text: string) => void>(() => undefined)

const VARIANTS = { primary: 'primary', danger: 'destructive' } as const

export const MessageCard = createRenderer(cardCatalog, {
  Card: ({ element: { props }, children }) => {
    const brand = props.brand && isBrand(props.brand) ? props.brand : undefined
    const subtitle = props.subtitle ?? (brand && integration(brand)?.short)
    return <div className="flex max-w-[560px] min-w-0 flex-col gap-3 rounded-lg border border-hair bg-sidebar p-4">
    <div className="flex min-w-0 items-center gap-3">
      {brand && <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-card shadow-[inset_0_0_0_1px_var(--hair)]"><Glyph name={brand} size={20} /></span>}
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-ink">{props.title}</div>
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
    if (inApp) return <a href={inApp} className={buttonVariants({ variant: 'text' })}>{props.label}</a>
    return <a href={props.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>{props.label}<span className="text-[11px] text-mute">↗</span></a>
  },
})
