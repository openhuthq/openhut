import { useEffect, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react'
import { Avatar } from '@/components/avatar'
import { Hut } from '@/components/hut'

const CALLS = [
  { key: 'ops', about: 'Order tracking', ask: 'Where is order #5102?', grant: 'orders · read', answer: 'Shipped Tuesday' },
  { key: 'support', about: 'Customer support', ask: 'Look up Dana', grant: 'customers · read', answer: 'Refund sent' },
  { key: 'growth', about: 'Metrics report', ask: 'Signups this week?', grant: 'analytics · read', answer: '412, up 9%' },
  { key: 'sales', about: 'Sales leads', ask: 'Read payroll', grant: 'payroll', answer: 'Not allowed', denied: true },
  { key: 'finance', about: 'Invoices', ask: 'Overdue invoices?', grant: 'billing · read', answer: '3 overdue' },
  { key: 'recruit', about: 'Hiring', ask: 'Next interview?', grant: 'hiring · read', answer: 'Thursday 10:00' },
]
const BEATS = 6
const BEAT_MS = 700
const LOOK_PX = 4

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return <div className="auth" onFocus={react} onInput={react} onBlur={(event) => { delete event.currentTarget.dataset.mood }}
    onPointerMove={(event) => { if (!event.currentTarget.dataset.mood) watch(event.currentTarget, event.clientX, event.clientY) }}>
    <title>{`${title} · OpenHut`}</title>
    <div className="authside"><div className="wordmark"><Hut />OpenHut</div>{children}</div>
    <aside className="authart" aria-hidden="true">
      <div className="floor"></div>
      <div className="moon"></div>
      <Story />
      <div className="hud"><h2>Your agents. Your server.</h2><p>Each in its own sandbox. Every key stays here.</p></div>
    </aside>
  </div>
}

function Story() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => setTick((value) => value + 1), BEAT_MS)
    return () => clearInterval(timer)
  }, [])
  const active = Math.floor(tick / BEATS) % CALLS.length
  const beat = tick % BEATS
  const call = CALLS[active]
  const [x, y] = spot(active)
  const atGate = beat === 1 || beat === 2 || (call.denied === true && beat > 2)
  const moving = beat === 1 || beat === 2 || (!call.denied && (beat === 3 || beat === 4))
  const looking = beat >= 1 && beat <= 3
  return <div className={call.denied && beat >= 2 ? 'orbits denied' : 'orbits'} data-beat={beat}
    style={{ '--sx': looking ? x * LOOK_PX : 0, '--sy': looking ? y * LOOK_PX : 0 } as CSSProperties}>
    <div className="ring"></div>
    <div className="ring dash"></div>
    {CALLS.map((item, i) => <div key={item.key} className={i === active ? 'beam on' : 'beam'} style={{ rotate: `${i * 60 + 30}deg` }}></div>)}
    {CALLS.map((item, i) => {
      const [sx, sy] = spot(i)
      const talking = i === active && (beat === 0 || beat >= 4)
      return <div key={item.key} className={talking ? 'sat talk' : 'sat'} style={{ translate: `calc(var(--r) * ${sx}) calc(var(--r) * ${sy})` }}>
        <Avatar id={`crew-${item.key}`} about={item.about} size={56} />
        {i === active && <span className={`say${sy > .5 ? ' below' : ''}${beat >= 4 ? ' done' : ''}`} key={beat >= 4 ? 'answer' : 'ask'}>{beat >= 4 ? call.answer : call.ask}</span>}
      </div>
    })}
    <span className={moving ? 'packet' : 'packet gone'} style={{ translate: atGate ? '0 0' : `calc(var(--r) * ${x}) calc(var(--r) * ${y})` }}></span>
    <div className="core"><Hut /><Shutters /></div>
    {beat >= 2 && beat <= 4 && <span className="verdict" key={tick - beat}>{call.denied ? '✕' : '✓'} {call.grant}{call.denied ? ' · no grant' : ''}</span>}
  </div>
}

function spot(i: number) {
  const angle = (i * 60 + 30) * Math.PI / 180
  return [Number(Math.sin(angle).toFixed(3)), Number((-Math.cos(angle)).toFixed(3))]
}

function Shutters() {
  return <svg className="shutters" viewBox="4 8 100 100">{[44, 64].map(x =>
    <rect key={x} x={x - 9.5} y="68" width="19" height="16" rx="3" fill="#c9952a" stroke="#0b0b0b" strokeWidth="3.5" />)}</svg>
}

function react(event: SyntheticEvent<HTMLElement>) {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.type === 'hidden') return
  event.currentTarget.dataset.mood = input.type === 'password' ? 'shy' : 'reading'
  const box = input.getBoundingClientRect()
  watch(event.currentTarget, box.left + Math.min(box.width - 12, 12 + input.value.length * 8), box.top + box.height / 2)
}

function watch(root: HTMLElement, x: number, y: number) {
  const eyes = root.querySelector('.core')?.getBoundingClientRect()
  if (!eyes) return
  const dx = x - (eyes.left + eyes.width / 2), dy = y - (eyes.top + eyes.height / 2), distance = Math.hypot(dx, dy) || 1
  const reach = Math.min(1, distance / 240) * LOOK_PX / distance
  root.style.setProperty('--lx', (dx * reach).toFixed(2))
  root.style.setProperty('--ly', (dy * reach).toFixed(2))
}
