import type { ReactNode } from 'react'
import { LaptopIcon, Tick02Icon, PlusSignIcon, ServerStack01Icon, SmartPhone01Icon, WifiDisconnected02Icon } from '@hugeicons/core-free-icons'
import type { Computer, OpenHutAgent, TailnetPeer } from '@openhut/client'
import type { Admin } from '@openhut/common/admin/admin.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { I, PILL } from '@/components/kit'
import { useAgents } from '@/features/agents/api'
import { useComputerAdmins, useComputers, useRemoveComputer, useUpdateComputer } from '@/features/computers/api'
import { useEnroll, useEnrollments, type Enrollment } from '@/features/computers/enroll'
import { failureOf, phaseOf } from '@/features/computers/enroll-steps'
import { HERE, useTailnet } from '@/features/settings/desktop'
import { byEligibility, stateOf, type Peer, type PeerState } from '@/features/settings/peers'
import { PairDialog, Waiting } from '@/features/settings/invite'
import { joinCommand } from '@/features/settings/invitation'
import { Chevron, Command, Intro, Row, Rows, SubPage, useConfirming } from '@/features/settings/kit'
import { UpdateStatus } from '@/features/settings/update-pill'
import { isPhone } from '@/lib/native'
import { open, useOpen } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const WHY: Record<Exclude<PeerState, 'ready'>, string> = { 'ssh-off': 'Turn on Tailscale SSH', offline: 'Offline', phone: "Phones can't run agents", 'not-linux': 'Linux only' }
const OS: Record<string, string> = { linux: 'Linux', macOS: 'macOS', windows: 'Windows', iOS: 'iOS', android: 'Android' }
const GET_TAILSCALE = 'https://tailscale.com/download'

export function ComputersSettings() {
  const [step, name = ''] = (useOpen() ?? '').split(':')
  if (step === 'tailscale') return <TailscaleStep />
  if (step === 'ssh') return <TurnOnSsh name={name} />
  return <>
    <ComputerList />
    {step === 'add' && <AddComputer />}
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
      {!isPhone() && <Row onClick={() => open('add')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-green" />} title="Add a computer" note={`An always-on Linux computer keeps agents answering while this ${HERE} sleeps.`}><Chevron /></Row>}
    </Rows>
  </>
}

function noteOf({ computer, admin, count }: { computer: Computer; admin: Admin | undefined; count: number }) {
  if (!computer.online) return 'Offline'
  if (computer.appTooOld) return 'Update OpenHut to use this computer'
  if (computer.runtimeTooOld) return 'Update this computer to use it'
  const failed = admin?.server.update?.status === 'failed' ? admin.server.update : null
  if (failed) return `Couldn't update to ${failed.to}. ${sentence(failed.reason ?? 'The update stopped before it finished.')}`
  return [`Online · ${agentCount(count)}`, admin && `OpenHut ${computer.id === 'local' ? admin.server.version : admin.server.build}`].filter(Boolean).join(' · ')
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
  const { start, dismiss } = useEnroll()
  const failed = enrollment.status === 'failed'
  const note = failed ? failureOf({ error: enrollment.error, url: enrollment.url, name: enrollment.peer.name }).sentence : phaseOf(enrollment.lines)
  return <Row icon={<Mark icon={ServerStack01Icon} dot={failed ? 'bg-fail' : undefined} />} title={enrollment.peer.name} note={note}>
    {failed
      ? <>
        <Button type="button" variant="secondary" className={PILL} onClick={() => start(enrollment.peer)}>Try again</Button>
        <Button type="button" variant="ghost" className={PILL} onClick={() => dismiss(enrollment.peer.dns)}>Remove</Button>
      </>
      : <Spinner className="mt-0" />}
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
  const add = (peer: Peer) => { start({ name: peer.name, dns: peer.dns } satisfies TailnetPeer); open() }
  return <SubPage title="Tailscale" back="">
    {!data && <p className="m-0 flex items-center gap-2 px-2.5 text-[13px] text-mute"><Spinner className="mt-0" />Looking at your tailnet…</p>}
    {data?.state === 'missing' && <Empty title="Install Tailscale to reach your other computers" line="OpenHut finds and sets up your other computers over Tailscale.">
      <a href={GET_TAILSCALE} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Get Tailscale</a>
      <Button type="button" variant="ghost" className={PILL} disabled={tailnet.isFetching} onClick={recheck}>I've installed it</Button>
    </Empty>}
    {data?.state === 'stopped' && <Empty title="Open Tailscale and sign in" line={`Tailscale is installed but not connected on this ${HERE}.`}>
      <Button type="button" variant="secondary" className={PILL} disabled={tailnet.isFetching} onClick={recheck}>Check again</Button>
    </Empty>}
    {data?.state === 'running' && <Peers peers={data.peers} tailnet={data.tailnet} recheck={recheck} checking={tailnet.isFetching} onAdd={add} />}
  </SubPage>
}

function Peers({ peers, tailnet, recheck, checking, onAdd }: { peers: Peer[]; tailnet: string; recheck: () => void; checking: boolean; onAdd: (peer: Peer) => void }) {
  const added = new Set((useComputers().data ?? []).map((computer) => computer.name))
  const enrolling = new Set(useEnrollments().data.map((each) => each.peer.dns))
  const sorted = byEligibility(peers)
  if (!sorted.some((peer) => stateOf(peer) === 'ready' || stateOf(peer) === 'ssh-off')) return <Empty title="No other computers on your tailnet yet" line="Install Tailscale on an always-on Linux computer and sign in with the same account.">
    <Button type="button" variant="secondary" className={PILL} disabled={checking} onClick={recheck}>Check again</Button>
  </Empty>
  return <>
    <Intro>On {tailnet || 'your tailnet'}. Linux computers that are online with Tailscale SSH on can run agents.</Intro>
    <Rows>{sorted.map((peer) => {
      const state = stateOf(peer)
      const note = [OS[peer.os] ?? peer.os, peer.ip].filter(Boolean).join(' · ')
      const icon = <I icon={iconOf(state)} size={20} className={state === 'ready' ? 'text-hue-blue' : 'text-mute'} />
      if (added.has(peer.name) || enrolling.has(peer.dns)) return <Row key={peer.name} icon={icon} title={peer.name} note={note}><span className="text-mute">{added.has(peer.name) ? 'Added' : 'Adding…'}</span></Row>
      if (state === 'ready') return <Row key={peer.name} onClick={() => onAdd(peer)} icon={icon} title={peer.name} note={note}><span className="text-mute">Add</span><Chevron /></Row>
      if (state === 'ssh-off') return <Row key={peer.name} onClick={() => open(`ssh:${peer.name}`)} icon={icon} title={peer.name} note={note}><span className="text-mute">{WHY[state]}</span><Chevron /></Row>
      return <Row key={peer.name} icon={icon} title={<span className="text-mute">{peer.name}</span>} note={note}><span className="text-mute">{WHY[state]}</span></Row>
    })}</Rows>
  </>
}

function Empty({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <Glyph name="tailscale" size={32} />
    <span className="mt-2 text-[14px] font-medium">{title}</span>
    <span className="max-w-[360px] text-[13px] text-balance text-mute">{line}</span>
    <span className="mt-2 flex items-center gap-2">{children}</span>
  </div>
}

function TurnOnSsh({ name }: { name: string }) {
  const tailnet = useTailnet()
  return <SubPage title={`Turn on Tailscale SSH on ${name}`} back="tailscale">
    <p className="m-0 px-2.5 text-[13px]/[18px] text-body">OpenHut installs itself over Tailscale SSH. Run this once on {name}, then check again.</p>
    <div className="px-2.5"><Command text="sudo tailscale set --ssh" /></div>
    <div className="px-2.5"><Button type="button" variant="secondary" className={PILL} disabled={tailnet.isFetching} onClick={() => void tailnet.refetch().then(() => open('tailscale'))}>Check again</Button></div>
  </SubPage>
}

function AddComputer() {
  return <PairDialog
    title="Add a computer"
    check={(device) => `Allow it only if ${device.name} shows the same numbers. Your agents can run there once it joins.`}
    waiting={(code) => <>
      <p className="m-0 text-body">Run this on an always-on Linux computer. It installs OpenHut there and adds it to your computers.</p>
      <Command text={joinCommand(code)} />
      <Waiting>Waiting for it to join…</Waiting>
      <p className="m-0 border-t border-hair pt-4 text-mute">You can also add one <Button type="button" variant="link" onClick={() => open('tailscale')}>over Tailscale</Button>.</p>
    </>}
  />
}

function iconOf(state: PeerState) {
  if (state === 'offline') return WifiDisconnected02Icon
  if (state === 'phone') return SmartPhone01Icon
  return ServerStack01Icon
}
