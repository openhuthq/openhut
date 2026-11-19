import { useEffect, useState, type ReactNode } from 'react'
import { ComputerTerminal01Icon, LaptopIcon, Tick02Icon, PlusSignIcon, ServerStack01Icon } from '@hugeicons/core-free-icons'
import type { Computer, OpenHutAgent, TailnetPeer } from '@openhut/client'
import type { Admin } from '@openhut/common/admin/admin.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { Meter } from '@/components/ui/meter'
import { Glyph } from '@/components/glyph'
import { I, PILL } from '@/components/kit'
import { useAgents } from '@/features/agents/api'
import { useComputerAdmins, useComputers, useRemoveComputer, useUpdateComputer } from '@/features/computers/api'
import { useEnroll, useEnrollments, type Enrollment } from '@/features/computers/enroll'
import { detailsOf, failureOf, percentOf, phaseOf, stageOf } from '@/features/computers/enroll-steps'
import { HERE, useTailnet } from '@/features/settings/desktop'
import { WORDS } from '@/lib/platform'
import { byEligibility, stateOf, type Peer } from '@/features/settings/peers'
import { PairDialog, Waiting } from '@/features/settings/invite'
import { joinCommand } from '@/features/settings/invitation'
import { Chevron, Command, Intro, Row, Rows, useConfirming } from '@/features/settings/kit'
import { UpdateStatus } from '@/features/settings/update-pill'
import { isPhone } from '@/lib/native'
import { APP_VERSION } from '@/lib/openhut'
import { open, useOpen } from '@/lib/router'
import { toastError } from '@/lib/toast'
import type { Mood } from '@/lib/hut'
import { cn } from '@/lib/utils'

const GET_TAILSCALE = 'https://tailscale.com/download'

export function ComputersSettings() {
  const [step, name = ''] = (useOpen() ?? '').split(':')
  return <>
    <ComputerList />
    {step === 'add' && <AddComputer />}
    {step === 'command' && <AddByCommand />}
    {step === 'tailscale' && <TailscaleStep />}
    {step === 'ssh' && <TurnOnSsh name={name} />}
    {step === 'adding' && <Adding name={name} />}
  </>
}

function ComputerList() {
  const computers = useComputers()
  const admins = useComputerAdmins().data
  const agents = useAgents().data ?? []
  const enrollments = useEnrollments().data
  return <>
    <Intro>Run your agents</Intro>
    <ErrorNote message={computers.error?.message} />
    <Rows>
      {computers.data?.map((computer) => {
        const admin = admins?.find((each) => each.computer.id === computer.id)?.admin
        if (admin?.server.update?.status === 'running') return <UpdatingRow key={computer.id} computer={computer} />
        const note = noteOf({ computer, admin, count: agents.filter((agent) => agent.computer === computer.id).length })
        if (computer.id === 'local') return <Row key={computer.id} icon={<ComputerMark computer={computer} />} title={computer.name} note={note}>{!isPhone() && <UpdateStatus idle={<span className="inline-flex items-center gap-1"><I icon={Tick02Icon} size={14} />Current</span>} />}</Row>
        return <RemovableRow key={computer.id} computer={computer} admin={admin} note={note} agents={agents.filter((agent) => agent.computer === computer.id)} />
      })}
      {enrollments.map((enrollment) => <EnrollRow key={enrollment.peer.dns} enrollment={enrollment} />)}
      {!isPhone() && <Row onClick={() => open('add')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-green" />} title="Add a computer" note={`A Linux server gives each agent its own sandbox and keeps answering while this ${HERE} sleeps.`}><Chevron /></Row>}
    </Rows>
  </>
}

function noteOf({ computer, admin, count }: { computer: Computer; admin: Admin | undefined; count: number }) {
  if (!computer.online) return 'Offline'
  if (computer.appTooOld) return 'Update OpenHut to use this computer'
  if (computer.runtimeTooOld) return 'Update this computer to use it'
  const failed = admin?.server.update?.status === 'failed' ? admin.server.update : null
  if (failed) return `Couldn't update to ${failed.to}. ${sentence(failed.reason ?? 'The update stopped before it finished.')}`
  return [computer.id === 'local' && !WORDS.sandboxed ? 'Agents run as you' : 'Each agent in its own sandbox', agentCount(count), admin && `OpenHut ${computer.id === 'local' ? admin.server.version : admin.server.build}`].filter(Boolean).join(' · ')
}

function sentence(text: string) {
  const trimmed = text.trim()
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? '' : '.'}`
}

function agentCount(count: number) {
  if (!count) return 'No agents'
  return `${count} agent${count === 1 ? '' : 's'}`
}

export function ComputerMark({ computer }: { computer: Computer }) {
  return <Mark icon={computer.id === 'local' ? LaptopIcon : ServerStack01Icon} dot={computer.online ? 'bg-pass' : 'bg-mute-2'} />
}

function Mark({ icon, dot }: { icon: typeof LaptopIcon; dot?: string }) {
  return <span className="relative inline-grid place-items-center">
    <I icon={icon} size={20} className="text-hue-blue" />
    {dot && <i className={cn('absolute -right-1 -bottom-0.5 size-2.5 rounded-full border-2 border-card', dot)} />}
  </span>
}


function RemovableRow({ computer, admin, note, agents }: { computer: Computer; admin: Admin | undefined; note: string; agents: OpenHutAgent[] }) {
  const remove = useRemoveComputer()
  const update = useUpdateComputer()
  const { confirming, setConfirming, box } = useConfirming()
  return <div ref={box}><Row icon={<ComputerMark computer={computer} />} title={computer.name} note={confirming ? 'Its agents stop and leave this list.' : note}>
    {confirming
      ? <>
        <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(false)}>Cancel</Button>
        <Button type="button" variant="danger" className={PILL} disabled={remove.isPending} onClick={() => remove.mutate({ id: computer.id, agents: agents.map((agent) => agent.id) }, { onError: toastError })}>Remove</Button>
      </>
      : <>
        {admin?.server.updateAvailable && (update.isPending
          ? <span className="inline-flex items-center gap-1.5"><Spinner className="mt-0" />Updating…</span>
          : <Button type="button" variant="secondary" className={PILL} onClick={() => update.mutate(computer, { onError: toastError })}>{admin.server.update?.status === 'failed' ? 'Try again' : 'Update'}</Button>)}
        <Button type="button" variant="danger" className={PILL} onClick={() => setConfirming(true)}>Remove</Button>
      </>}
  </Row></div>
}


function EnrollRow({ enrollment }: { enrollment: Enrollment }) {
  const failed = enrollment.status === 'failed'
  const now = useNow(!failed)
  const note = failed ? failureOf({ error: enrollment.error, url: enrollment.url, name: enrollment.peer.name }).sentence : `${phaseOf(enrollment.lines)} ${percentOf({ lines: enrollment.lines, waitingAt: enrollment.waitingAt, now })}%`
  return <Row onClick={() => open(`adding:${enrollment.peer.name}`)} icon={<Mark icon={ServerStack01Icon} dot={failed ? 'bg-fail' : undefined} />} title={enrollment.peer.name} note={note}>
    {failed ? <Chevron /> : <Spinner className="mt-0" />}
  </Row>
}

function UpdatingRow({ computer }: { computer: Computer }) {
  return <Row icon={<ComputerMark computer={computer} />} title={computer.name} note="Updating…"><Spinner className="mt-0" /></Row>
}

function TailscaleStep() {
  const tailnet = useTailnet()
  const { start } = useEnroll()
  const recheck = () => void tailnet.refetch()
  const data = tailnet.data
  const add = (peer: Peer) => { start({ name: peer.name, dns: peer.dns } satisfies TailnetPeer); open(`adding:${peer.name}`) }
  return <TailscaleDialog title="Add over Tailscale" back={<Button type="button" variant="secondary" onClick={() => open('add')}>Back</Button>}>
    {!data && <Scene mood="looking" title="Looking at your tailnet…" />}
    {data?.state === 'missing' && <Empty title="Install Tailscale to reach your other computers" line="OpenHut finds and sets up your other computers over Tailscale.">
      <a href={GET_TAILSCALE} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Get Tailscale</a>
      <Button type="button" variant="ghost" className={PILL} disabled={tailnet.isFetching} onClick={recheck}>I've installed it</Button>
    </Empty>}
    {data?.state === 'stopped' && <Empty title="Open Tailscale and sign in" line={`Tailscale is installed but not connected on this ${HERE}.`}>
      <Button type="button" variant="secondary" className={PILL} disabled={tailnet.isFetching} onClick={recheck}>Check again</Button>
    </Empty>}
    {data?.state === 'running' && <Peers peers={data.peers} tailnet={data.tailnet} recheck={recheck} checking={tailnet.isFetching} onAdd={add} />}
  </TailscaleDialog>
}

function Peers({ peers, tailnet, recheck, checking, onAdd }: { peers: Peer[]; tailnet: string; recheck: () => void; checking: boolean; onAdd: (peer: Peer) => void }) {
  const added = new Set((useComputers().data ?? []).map((computer) => computer.name))
  const enrolling = new Set(useEnrollments().data.map((each) => each.peer.dns))
  const shown = byEligibility(peers).filter((peer) => stateOf(peer) === 'ready' || stateOf(peer) === 'ssh-off')
  const hidden = peers.length - shown.length
  if (!shown.length) return <Empty title="No other computers on your tailnet yet" line="Install Tailscale on an always-on Linux computer and sign in with the same account.">
    <Button type="button" variant="secondary" className={PILL} disabled={checking} onClick={recheck}>Check again</Button>
  </Empty>
  return <div className="flex flex-col gap-1.5">
    <p className="m-0 px-2.5 text-body">Pick a Linux computer on {tailnet || 'your tailnet'}. OpenHut installs itself there over Tailscale SSH, then reaches it through its relay.</p>
    <Rows>{shown.map((peer) => {
      const ready = stateOf(peer) === 'ready'
      const note = ['Linux', peer.ip, !ready && 'Tailscale SSH is off'].filter(Boolean).join(' · ')
      const icon = <I icon={ServerStack01Icon} size={20} className={ready ? 'text-hue-blue' : 'text-mute'} />
      return <Row key={peer.dns} icon={icon} title={peer.name} note={note}>
        {added.has(peer.name)
          ? <Button type="button" variant="ghost" className={PILL} disabled><I icon={Tick02Icon} size={14} className="text-pass" />Added</Button>
          : enrolling.has(peer.dns)
            ? <Button type="button" variant="ghost" className={PILL} onClick={() => open(`adding:${peer.name}`)}>Adding…</Button>
            : <Button type="button" variant="secondary" className={PILL} onClick={() => ready ? onAdd(peer) : open(`ssh:${peer.name}`)}>{ready ? 'Add' : 'Set up'}</Button>}
      </Row>
    })}</Rows>
    {hidden > 0 && <p className="m-0 px-2.5 pt-1 text-[12px]/[16px] text-mute">{hidden === 1 ? '1 offline or non-Linux device isn\'t' : `${hidden} offline or non-Linux devices aren't`} shown.</p>}
  </div>
}

function Empty({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <Glyph name="tailscale" size={32} />
    <span className="mt-2 text-[14px] font-medium">{title}</span>
    <span className="max-w-[360px] text-[13px] text-balance text-mute">{line}</span>
    <span className="mt-2 flex items-center gap-2">{children}</span>
  </div>
}

function Scene({ mood, title, line, children }: { mood: Mood; title: string; line?: ReactNode; children?: ReactNode }) {
  return <div className="flex flex-col items-center gap-4 px-6 pt-4 pb-2 text-center">
    {children ?? <Hut mood={mood} className="size-24" />}
    <div className="flex flex-col gap-1">
      <span className="text-[15px]/[22px] font-medium">{title}</span>
      {line && <span className="max-w-[400px] text-balance text-mute">{line}</span>}
    </div>
  </div>
}

function TurnOnSsh({ name }: { name: string }) {
  const tailnet = useTailnet({ poll: true })
  const peer = tailnet.data?.state === 'running' ? tailnet.data.peers.find((each) => each.name === name) : undefined
  useEffect(() => { if (peer?.ssh) open('tailscale') }, [peer?.ssh])
  return <TailscaleDialog title="Turn on Tailscale SSH" back={<Button type="button" variant="secondary" onClick={() => open('tailscale')}>Back</Button>}>
    <div className="flex items-center gap-4 px-2.5">
      <Hut mood="key" className="size-[72px]" />
      <p className="m-0 flex-1 text-body">Run this once on {name}. OpenHut installs itself over Tailscale SSH, so it needs to be on.</p>
    </div>
    <div className="px-2.5"><Command text="sudo tailscale set --ssh" /></div>
    <div className="px-2.5"><Waiting note="It moves on by itself once SSH is on.">Waiting for SSH on {name}…</Waiting></div>
  </TailscaleDialog>
}

function Adding({ name }: { name: string }) {
  const enrollment = useEnrollments().data.find((each) => each.peer.name === name)
  const computer = useComputers().data?.find((each) => each.name === name)
  const { start, dismiss } = useEnroll()
  const now = useNow(enrollment?.status === 'running')
  const hide = <Button type="button" variant="secondary" onClick={() => open()}>Hide</Button>
  if (computer && !enrollment) return <TailscaleDialog title="Add over Tailscale" foot={<Button type="button" variant="primary" onClick={() => open()}>Done</Button>}>
    <Scene mood="party" title={`${name} joined`} line={`Agents can run there now, even while this ${HERE} sleeps.`} />
  </TailscaleDialog>
  if (enrollment?.status === 'failed') {
    const retry = <Button type="button" variant="primary" onClick={() => start(enrollment.peer)}>Try again</Button>
    const remove = <Button type="button" variant="secondary" onClick={() => { dismiss(enrollment.peer.dns); open('tailscale') }}>Back</Button>
    const details = detailsOf({ enrollment, version: APP_VERSION })
    return <TailscaleDialog title="Add over Tailscale" back={remove} foot={<><CopyButton text={details} label="Copy details" />{retry}</>}>
      <Scene mood="worried" title={`${name} didn't join`} line={failureOf({ error: enrollment.error, url: enrollment.url, name }).sentence} />
      <details className="mx-2.5 rounded-lg border border-hair">
        <summary className="cursor-pointer px-3 py-2 text-mute select-none">Show details</summary>
        <pre className="m-0 max-h-40 overflow-auto border-t border-hair bg-tint px-3 py-2 font-mono text-[11px]/[1.6] whitespace-pre-wrap text-ink">{details}</pre>
      </details>
    </TailscaleDialog>
  }
  const stage = stageOf(enrollment?.lines ?? [])
  const percent = percentOf({ lines: enrollment?.lines ?? [], waitingAt: enrollment?.waitingAt, now })
  return <TailscaleDialog title="Add over Tailscale" back={hide} foot={<span className="text-[12px] text-mute">It keeps going if you close this.</span>}>
    <Scene mood="building" title={`Moving into ${name}`} line={enrollment?.url
      ? <>Tailscale wants you to approve this. <a href={enrollment.url} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">Open the approval page</a></>
      : <>{stage.line} · <span className="font-medium text-ink tabular-nums">{percent}%</span></>}>
      <div className="relative h-28 w-full max-w-[300px]">
        <Meter className="absolute inset-x-0 bottom-0 h-1.5 rounded-full bg-soft" value={percent} aria-label="How far along" />
        <Hut mood="building" className="absolute bottom-3 size-20 transition-[left] duration-700" style={{ left: `calc(${percent}% - 40px)` }} />
      </div>
    </Scene>
  </TailscaleDialog>
}

function TailscaleDialog({ title, back, foot, children }: { title: string; back?: ReactNode; foot?: ReactNode; children: ReactNode }) {
  const close = () => open()
  return <Dialog size="narrow" label={title} onClose={close}>
    <DialogHead title={title} onClose={close} />
    <div className="flex max-h-[min(480px,calc(100vh-200px))] flex-col gap-4 overflow-y-auto px-3 py-5 text-[13px]/[18px]">{children}</div>
    {(back || foot) && <DialogFoot start={back}>{foot}</DialogFoot>}
  </Dialog>
}

function AddComputer() {
  return <TailscaleDialog title="Add a computer">
    <p className="m-0 px-2.5 text-body">An always-on Linux computer gives each agent its own sandbox and keeps answering while this {HERE} sleeps. How do you want to add it?</p>
    <Rows>
      <Row onClick={() => open('command')} icon={<I icon={ComputerTerminal01Icon} size={20} className="text-hue-blue" />} title="Run a command" note="Paste one line on the computer. Works on any Linux box you can open a terminal on."><Chevron /></Row>
      <Row onClick={() => open('tailscale')} icon={<Glyph name="tailscale" size={20} />} title="Over Tailscale" note="Pick it from your tailnet and OpenHut installs itself. No terminal needed."><Chevron /></Row>
    </Rows>
  </TailscaleDialog>
}

function AddByCommand() {
  return <PairDialog
    title="Run a command"
    back={() => open('add')}
    check={(device) => `Allow it only if ${device.name} shows the same numbers. Your agents can run there once it joins.`}
    waiting={(code) => <>
      <p className="m-0 text-body">Run this on an always-on Linux computer. It installs OpenHut there and adds it to your computers.</p>
      <Command text={joinCommand(code)} />
      <Waiting>Waiting for it to join…</Waiting>
    </>}
  />
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [ticking])
  return now
}

