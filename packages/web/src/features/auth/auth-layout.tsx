import type { ReactNode } from 'react'
import { Avatar } from '@/components/avatar'
import { ICONS } from '@/components/icons'

const CREW = [['dev', 'Dev', 'Engineering questions'], ['sales', 'Sales', 'The weekly pipeline'], ['support', 'Support', 'Customer support'], ['ops', 'Ops', 'Overnight alerts']]

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return <div className="auth">
    <title>{`${title} · Fast Monkey`}</title>
    <div className="authside"><div className="authbrand"><div className="logo" aria-hidden="true">{ICONS.logo}</div>Fast Monkey</div>{children}</div>
    <aside className="authart" aria-hidden="true">
      <div className="crewgrid">{CREW.map(([key, name, role]) =>
        <div className="crew" key={key}><Avatar id={`crew-${key}`} about={role} size={40} /><div className="t"><div className="cn">{name}</div><div className="cr">{role}</div></div><span className="cdot"></span></div>)}</div>
      <p className="tag">Your agents, on your own server.</p><p className="tagsub">Each in its own sandbox. Every key stays here.</p>
    </aside>
  </div>
}
