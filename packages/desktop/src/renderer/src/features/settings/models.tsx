import { useEffect, useRef } from 'react'
import type { Admin, SeatUsage } from '@openhut/common/admin/admin.ts'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { useAdmin, useCompleteSeatSignIn, useSeatUsage, useStartSeatSignIn } from '@/features/settings/api'
import { useComputerAdmins } from '@/features/computers/api'
import { DialogCard, PILL, Section, Status } from '@/components/kit'
import { CardTitle, Intro, Row, Rows } from '@/features/settings/kit'
import { open, useOpen } from '@/lib/router'
import { formValues } from '@/lib/form'

const SPEND_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const LIST = new Intl.ListFormat('en-GB', { type: 'conjunction' })
const resetTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export function ModelsSettings() {
  const admin = useAdmin()
  const dialog = useOpen()
  const signedIn = !!admin.data && admin.data.seat.mode === 'claude' && admin.data.seat.set
  const usage = useSeatUsage(signedIn)
  const holders = useComputerAdmins().data?.filter((each) => each.admin?.seat.set).map((each) => each.computer.name) ?? []
  return <>
    <Intro>Sign in with the subscription you already pay for. Each agent then picks one.</Intro>
    <ErrorNote message={admin.error?.message} />
    {admin.data && <Rows>
      <Row icon={<Glyph name="claude" size={22} />} title="Claude subscription" note={holders.length ? `On ${listOf(holders)}` : 'Pro or Max'}>
        <Claude admin={admin.data} />
      </Row>
      <Row icon={<Glyph name="openai" size={22} />} title="Codex subscription" note="ChatGPT Plus or Pro">
        <span className="text-[12px] text-mute">Coming soon</span>
      </Row>
    </Rows>}
    {usage.data && <Spend usage={usage.data} />}
    {dialog === 'seat' && <SeatSignIn />}
  </>
}

function Claude({ admin }: { admin: Admin }) {
  if (admin.seat.mode === 'test') return <span className="text-mute" title="This build answers with the built-in test model, not a Claude seat">Test model (development)</span>
  if (!admin.seat.set) return <Button variant="secondary" className={PILL} onClick={() => open('seat')}>Sign in</Button>
  return <Status tone="on">Signed in</Status>
}

function listOf(names: string[]) {
  return LIST.format(names)
}

function usageLine(usage: SeatUsage | undefined) {
  const fiveHour = usage?.windows.find((each) => each.kind === 'five_hour')
  if (!fiveHour) return undefined
  const reset = fiveHour.resetsAt ? ` · resets ${resetTime.format(new Date(fiveHour.resetsAt))}` : ''
  return `${Math.round(fiveHour.percent)}% of the 5-hour limit used${reset}`
}

function Spend({ usage }: { usage: SeatUsage }) {
  const used = [...usage.agents].filter((agent) => agent.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd)
  const total = used.reduce((sum, agent) => sum + agent.costUsd, 0)
  const week = usage.windows.find((each) => each.kind === 'seven_day')
  return <Section title="Claude this week" action={<span className="text-mute">{[usageLine(usage), week && `${week.percent}% of the weekly limit`].filter(Boolean).join(' · ')}</span>}>
    {used.length
      ? <Rows>{used.map((agent, index) => <Row key={agent.agentId} icon={<i className="size-2.5 rounded-[3px]" style={{ background: SPEND_COLORS[index % SPEND_COLORS.length] }} />} title={agent.agentName}>
        <span className="text-mute tabular-nums">{Math.max(1, Math.round((agent.costUsd / total) * 100))}%</span>
        <span className="w-16 text-right font-mono text-xs tabular-nums">${agent.costUsd.toFixed(2)}</span>
      </Row>)}</Rows>
      : <p className="m-0 px-2.5 text-[12px]/[16px] text-mute">Not used yet.</p>}
  </Section>
}

function SeatSignIn() {
  const start = useStartSeatSignIn()
  const complete = useCompleteSeatSignIn()
  const started = useRef(false)
  const { mutate } = start
  useEffect(() => {
    if (started.current) return
    started.current = true
    mutate(undefined, { onSuccess: (signIn) => { if (signIn.url) window.open(signIn.url, '_blank') } })
  }, [mutate])
  const signIn = start.data
  return <DialogCard className="w-[520px]" onClose={() => open()}>
    <form className="contents" onSubmit={(event) => signIn && complete.mutate({ id: signIn.id, code: formValues(event)('code') }, { onSuccess: () => open() })}>
      <div className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-lg bg-[#D97757]/12"><Glyph name="claude" size={20} /></span><CardTitle>Sign in with Claude</CardTitle></div>
      {start.error
        ? <FieldError>{start.error.message}</FieldError>
        : <p className="m-0 text-[13px]/[18px] text-body">{signIn?.url
          ? <>claude.ai opened in your browser. Press Authorize there, then paste the code it shows. <a href={signIn.url} target="_blank" rel="noreferrer">Open claude.ai again</a></>
          : <span className="inline-flex items-center gap-2"><Spinner className="mt-0" />Starting the Claude sign-in. This takes about 10 seconds.</span>}</p>}
      <Input mono name="code" required minLength={10} autoComplete="off" spellCheck={false} aria-label="Code from claude.ai" placeholder="Paste the code from claude.ai" disabled={!signIn} autoFocus />
      {complete.error && <FieldError>{complete.error.message}</FieldError>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => open()}>Cancel</Button><Button type="submit" variant="primary" disabled={!signIn || complete.isPending}>{complete.isPending ? 'Connecting…' : 'Connect'}</Button></div>
    </form>
  </DialogCard>
}
