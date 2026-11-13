import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Health, type Admin } from '@fastmonkey/common/admin/admin.ts'
import { Monkey } from '@/components/monkey'
import { useStartUpdate } from '@/features/admin/api'

type Phase = 'ask' | 'downloading' | 'restarting' | 'done' | 'stuck'

const STEPS: { phase: Phase; label: string }[] = [
  { phase: 'downloading', label: 'Downloading the new release' },
  { phase: 'restarting', label: 'Restarting Fast Monkey and its agents' },
  { phase: 'done', label: 'Back online' },
]
const POLL_MS = 2_000
const GIVE_UP_MS = 10 * 60_000
const RELOAD_MS = 2_200

export function UpdateButton({ server }: { server: Admin['server'] }) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const startUpdate = useStartUpdate()
  const [phase, setPhase] = useState<Phase>('ask')
  const [from, setFrom] = useState(server.build)
  const [to, setTo] = useState(server.latestBuild)
  const running = phase === 'downloading' || phase === 'restarting'

  useEffect(() => {
    if (!running) return
    const poll = setInterval(() => {
      void health().then((now) => {
        if (now?.ok && now.build !== from) setPhase('done')
        else if (!now?.ok) setPhase('restarting')
      })
    }, POLL_MS)
    const giveUp = setTimeout(() => setPhase('stuck'), GIVE_UP_MS)
    return () => { clearInterval(poll); clearTimeout(giveUp) }
  }, [running, from])

  useEffect(() => {
    if (phase !== 'done') return
    const reload = setTimeout(() => location.reload(), RELOAD_MS)
    return () => clearTimeout(reload)
  }, [phase])

  const close = () => { ref.current?.close(); setPhase('ask'); startUpdate.reset() }
  return <>
    {server.updateAvailable && <button type="button" className="btn primary sm" onClick={() => ref.current?.showModal()}>Update now</button>}
    {createPortal(<dialog ref={ref} className="dlg confirm upd" aria-labelledby={headingId} onCancel={(event) => { if (phase !== 'ask') event.preventDefault() }}>
      <div className="updhead" data-phase={phase}><Monkey /></div>
      {phase === 'ask' && <>
        <div className="updbody">
          <h2 id={headingId}>Update Fast Monkey?</h2>
          <p className="mute">Fast Monkey and every running agent restart once. People, agents, connections and skills stay. It takes about a minute.</p>
          <div className="updbuilds"><span className="mono">{server.build}</span><span aria-hidden="true">→</span><span className="mono new">{server.latestBuild}</span></div>
          {startUpdate.error && <p className="err" role="alert">{startUpdate.error.message}</p>}
        </div>
        <div className="dlgfoot"><span></span><div className="dlgacts">
          <button type="button" className="btn sec" onClick={close}>Not now</button>
          <button type="button" className="btn primary" disabled={startUpdate.isPending} onClick={() => startUpdate.mutate(undefined, { onSuccess: (update) => { setFrom(update.from); setTo(update.to); setPhase('downloading') } })}>Update now</button>
        </div></div>
      </>}
      {phase !== 'ask' && <div className="updbody" role="status">
        <h2 id={headingId}>{title(phase)}</h2>
        <ol className="updsteps">{STEPS.map((step, index) => <li key={step.phase} data-state={stateOf(index, phase)}><i aria-hidden="true"></i>{step.label}</li>)}</ol>
        {phase === 'done' && <p className="mute">Now on build <span className="mono">{to}</span>. Reloading the page.</p>}
        {phase === 'stuck' && <>
          <p className="err">It hasn't come back after 10 minutes. On the server, run <code>journalctl -u fastmonkey-update</code> to see why, or run the install command again.</p>
          <div className="dlgacts"><button type="button" className="btn sec" onClick={close}>Close</button></div>
        </>}
      </div>}
    </dialog>, document.body)}
  </>
}

function title(phase: Phase) {
  if (phase === 'done') return 'Fast Monkey is up to date'
  if (phase === 'stuck') return 'The update is taking too long'
  return 'Updating Fast Monkey'
}

function stateOf(index: number, phase: Phase) {
  const current = STEPS.findIndex((step) => step.phase === phase)
  if (phase === 'done' || index < current) return 'done'
  return index === current ? 'now' : 'next'
}

async function health() {
  const response = await fetch('/health', { cache: 'no-store' }).catch(() => undefined)
  const parsed = Health.safeParse(await response?.json().catch(() => undefined))
  return parsed.success ? parsed.data : undefined
}
