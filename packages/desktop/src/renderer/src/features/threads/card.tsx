import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createRenderer } from '@json-render/react'
import { cardCatalog } from '@openhut/common/cards/card.ts'
import { Button } from '@/components/ui/button'
import { SWATCHES } from '@/lib/face'
import { cn } from '@/lib/utils'

export const CardReply = createContext<(text: string) => void>(() => undefined)

const PALE = new Set(['cream', 'yellow', 'mint', 'pink'])
const BUTTON = 'h-[30px] rounded-lg border border-solid px-3 text-[13.5px]'
const STYLES = {
  primary: 'border-transparent bg-(--agent-shade) text-white not-disabled:hover:brightness-110',
  danger: 'border-[color-mix(in_srgb,var(--color-fail)_35%,white)] bg-white text-fail not-disabled:hover:bg-[color-mix(in_srgb,var(--color-fail)_6%,white)]',
  secondary: 'border-hair bg-white text-ink shadow-[0_1px_1px_oklch(0%_0_0/.04)] not-disabled:hover:bg-sidebar',
}

export function AgentColor({ body, children }: { body: number; children: ReactNode }) {
  const swatch = SWATCHES[body % SWATCHES.length]
  const pale = PALE.has(swatch.id)
  return <div style={{ '--agent': pale ? swatch.shade : swatch.fill, '--agent-shade': pale ? 'var(--color-ink)' : swatch.shade } as CSSProperties}>{children}</div>
}

export const MessageCard = createRenderer(cardCatalog, {
  Card: ({ element: { props }, children }) => <div className="max-w-[560px] min-w-0 overflow-hidden rounded-xl border border-hair bg-card shadow-[0_1px_2px_oklch(0%_0_0/.04),0_8px_24px_oklch(0%_0_0/.06)]">
    <div className="flex gap-2.5 border-b border-[color-mix(in_srgb,var(--agent)_22%,white)] bg-[color-mix(in_srgb,var(--agent)_11%,white)] px-4 pt-3.5 pb-3">
      <span className="mt-[7px] size-2 shrink-0 rounded-full bg-(--agent)" />
      <div className="min-w-0">
        <div className="text-[15px] font-semibold tracking-[-.01em] text-ink">{props.title}</div>
        {props.subtitle && <div className="font-mono text-[12px] text-mute">{props.subtitle}</div>}
      </div>
    </div>
    <div className="flex flex-col gap-3.5 px-4 py-3.5">{children}</div>
  </div>,
  Text: ({ element: { props } }) => <div className="msg-t"><Markdown remarkPlugins={[remarkGfm]}>{props.content}</Markdown></div>,
  Fields: ({ children }) => <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">{children}</dl>,
  Field: ({ element: { props } }) => <div className="min-w-0 rounded-lg bg-sidebar px-2.5 py-2">
    <dt className="text-[10.5px] font-medium tracking-[.06em] text-mute uppercase">{props.label}</dt>
    <dd className="m-0 text-[14px] font-medium text-ink tabular-nums [overflow-wrap:anywhere]">{props.value}</dd>
  </div>,
  Table: ({ element: { props } }) => <div className="overflow-x-auto rounded-lg border border-hair">
    <table className="w-full border-collapse text-[13px] tabular-nums">
      <thead><tr>{props.headers.map((header, i) => <th key={i} className="bg-sidebar px-2.5 py-1.5 text-left text-[11.5px] font-medium text-mute">{header}</th>)}</tr></thead>
      <tbody>{props.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className="border-t border-hair px-2.5 py-1.5 text-ink">{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>,
  Chart: ({ element: { props } }) => {
    const top = Math.max(...props.values.map(Math.abs), 1)
    return <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-[12.5px] font-semibold text-ink">{props.title}</figcaption>
      {props.labels.map((label, i) => {
        const value = Math.abs(props.values[i] ?? 0)
        return <div key={i} className="grid grid-cols-[minmax(0,72px)_1fr_auto] items-center gap-2.5 text-[12.5px]">
          <span className="truncate text-mute">{label}</span>
          <span className="flex h-2 overflow-hidden rounded-full bg-tint">
            <span className={cn('rounded-full', value === top ? 'bg-(--agent)' : 'bg-[color-mix(in_srgb,var(--agent)_55%,white)]')} style={{ flexGrow: value }} />
            <span style={{ flexGrow: top - value }} />
          </span>
          <span className="text-right font-medium text-ink tabular-nums">{props.values[i]}</span>
        </div>
      })}
    </figure>
  },
  Image: ({ element: { props } }) => <img src={props.url} alt={props.alt} className="max-w-full rounded-lg border border-hair" />,
  Divider: () => <hr className="m-0 border-0 border-t border-dashed border-hair" />,
  Actions: ({ children }) => <div className="-mx-4 -mb-3.5 flex flex-wrap gap-2 border-t border-hair bg-[oklch(99%_0_0)] px-4 py-2.5">{children}</div>,
  Button: ({ element: { props } }) => {
    const reply = useContext(CardReply)
    return <Button type="button" size="none" className={cn(BUTTON, STYLES[props.style ?? 'secondary'])} onClick={() => reply(props.label)}>{props.label}</Button>
  },
  LinkButton: ({ element: { props } }) => <a href={props.url} target="_blank" rel="noreferrer" className="inline-flex h-[30px] items-center gap-1 rounded-lg px-1.5 text-[13.5px] font-medium text-mute no-underline hover:text-ink">{props.label}<span className="text-[11px]">↗</span></a>,
})
