import { useEffect, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LaptopIcon, Tick02Icon, PlusSignIcon, ServerStack01Icon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import type { Admin } from '@openhut/common/admin/admin.ts'
import type { Cloud, CloudWorkspaceView, DeviceRequest } from '@openhut/common/cloud/cloud.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'
import { ConfirmButton } from '@/components/confirm-button'
import { DeviceIcon, DeviceMeta } from '@/components/custom/device'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { Meter } from '@/components/ui/meter'
import { Glyph } from '@/components/glyph'
import { I, PILL } from '@/components/kit'
import { useAgents } from '@/features/agents/api'
import { useComputerAdmins, useComputers, useUpdateComputer } from '@/features/computers/api'
import { useEnroll, useEnrollments, type Enrollment } from '@/features/computers/enroll'
import { detailsOf, failureOf, percentOf, phaseOf, stageOf } from '@/features/computers/enroll-steps'
import { useTailnet } from '@/features/settings/desktop'
import { byEligibility, stateOf, type Peer } from '@/features/settings/peers'
import { Chevron, Command, Intro, Row, Rows } from '@/features/settings/kit'
import { UpdateStatus } from '@/features/settings/update-pill'
import { KeysToReplace } from '@/features/cloud/cloud'
import { REMOVE_DETAIL, REMOVE_POINTS, useCloud, useRemoveMac } from '@/features/cloud/api'
import { useApprove, useDeny } from '@/features/cloud/workspaces'
import { request } from '@/lib/api-client'
import { ago, shortDateTime } from '@/lib/format'
import { isPhone, useConfirmed } from '@/lib/native'
import { APP_VERSION, type Computer, type TailnetPeer } from '@/lib/openhut'
import { WORDS } from '@/lib/platform'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import type { Mood } from '@/lib/hut'
import { cn } from '@/lib/utils'
import { useAnswer } from '@/features/cloud/review'

const GET_TAILSCALE = 'https://tailscale.com/download'
const JoinCode = z.object({ code: z.string() })

type Device = Cloud['devices'][number]

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
  const { devices, requests, home } = mineOf(useCloud().data)
  const local = computers.data?.[0]
  const admin = admins?.find((each) => each.computer.id === local?.id)?.admin
  const here = devices.find((device) => device.here)
  return <>
    <KeysToReplace />
    <Intro>Your computers</Intro>
    <ErrorNote message={computers.error?.message} />
    <Rows>
      {local && admin?.server.update?.status === 'running' && <Row icon={<ComputerMark computer={local} />} title={here?.name ?? local.name} note="Updating…"><Spinner className="mt-0" /></Row>}
      {local && admin?.server.update?.status !== 'running' && <Row icon={<ComputerMark computer={local} />} title={here?.name ?? local.name} note={noteOf({ computer: local, admin, count: agents.filter((agent) => agent.runsHere).length, device: here })}>
        {!isPhone() && <UpdateStatus idle={<span className="inline-flex items-center gap-1"><I icon={Tick02Icon} size={14} />Up to date</span>} />}
      </Row>}
      {home && requests.map((each) => <RequestRow key={each.device} workspace={home} asked={each} />)}
      {devices.filter((device) => !device.here).map((device) => <DeviceRow key={device.key} device={device} />)}
      {enrollments.map((enrollment) => <EnrollRow key={enrollment.peer.dns} enrollment={enrollment} />)}
      {!isPhone() && <Row onClick={() => open('add')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-green" />} title="Add a computer" note="A Linux computer that stays on seals each agent in its own box and keeps answering while this computer sleeps."><Chevron /></Row>}
    </Rows>
  </>
}

function mineOf(cloud: Cloud | undefined): { devices: Device[]; requests: DeviceRequest[]; home: CloudWorkspaceView | undefined } {
  if (cloud?.status !== 'on' && cloud?.status !== 'offline') return { devices: [], requests: [], home: undefined }
  const home = cloud.workspaces.find((workspace) => workspace.home && workspace.own)
  return { devices: cloud.devices, requests: home?.requests.filter((each) => each.email === cloud.email) ?? [], home }
}

function noteOf({ computer, admin, count, device }: { computer: Computer; admin: Admin | undefined; count: number; device: Device | undefined }) {
  if (!computer.online) return 'Offline'
  if (computer.appTooOld) return 'Update OpenHut to use this computer'
  const failed = admin?.server.update?.status === 'failed' ? admin.server.update : null
  if (failed) return `Couldn't update to ${failed.to}. ${sentence(failed.reason ?? 'The update stopped before it finished.')}`
  return [isPhone() ? 'Your computer' : 'This computer', WORDS.sandboxed ? 'Each agent sealed in its own box' : 'Agents have your access', agentCount(count), admin && `OpenHut ${admin.server.version}`, addedOf(device)].filter(Boolean).join(' · ')
}

function addedOf(device: Device | undefined) {
  return device?.addedAt ? `Added ${shortDateTime.format(new Date(device.addedAt))}` : undefined
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

function DeviceRow({ device }: { device: Device }) {
  const remove = useRemoveMac()
  const update = useUpdateComputer()
  const server = device.kind === 'server'
  const name = device.name ?? (server ? 'Computer that runs agents' : 'Computer')
  const detail = device.addedAt ? `Added ${shortDateTime.format(new Date(device.addedAt))} · ${REMOVE_DETAIL}` : REMOVE_DETAIL
  return <Row icon={<DeviceIcon kind={device.kind} />} title={name} note={[server ? 'Runs agents' : 'Mac', addedOf(device)].filter(Boolean).join(' · ')}>
    {server && !isPhone() && update.isPending && <span className="inline-flex items-center gap-1.5"><Spinner className="mt-0" />Updating…</span>}
    {server && !isPhone() && !update.isPending && <Button type="button" variant="secondary" className={PILL} onClick={() => update.mutate({ id: tunnelKeyOf(device.key), name }, { onSuccess: () => toast(`${name} is updating`), onError: toastError })}>Update</Button>}
    {!isPhone() && <ConfirmButton className={PILL} disabled={remove.isPending} question={`Remove ${name}?`} detail={detail} points={REMOVE_POINTS} action="Remove" onConfirm={() => remove.mutate(device.key)}>Remove</ConfirmButton>}
  </Row>
}

function RequestRow({ workspace, asked }: { workspace: CloudWorkspaceView; asked: DeviceRequest }) {
  const title = asked.name ?? 'New computer'
  const answer = useAnswer({ workspace: workspace.id, request: asked, label: title })
  return <Row icon={<DeviceIcon kind="mac" />} title={title} note={<>Wants to join · <DeviceMeta device={{ kind: 'mac', name: title, os: asked.os ?? undefined, when: `${ago(asked.at)} ago` }} /></>}>
    <Button type="button" variant="ghost" className={PILL} disabled={answer.busy} onClick={answer.notMe}>Not me</Button>
    <Button type="button" variant="primary" className={PILL} disabled={answer.busy} onClick={answer.approve}>{asked.checked ? 'Review' : 'Approve'}</Button>
    {answer.dialog}
  </Row>
}

function tunnelKeyOf(deviceKey: string): string {
  return Array.from(atob(deviceKey).slice(32), (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

function useKnown(): (name: string) => boolean {
  const { devices, requests } = mineOf(useCloud().data)
  return (name) => devices.some((device) => device.name === name) || requests.some((each) => each.name === name)
}

function EnrollRow({ enrollment }: { enrollment: Enrollment }) {
  const failed = enrollment.status === 'failed'
  const now = useNow(!failed)
  const note = failed ? failureOf({ error: enrollment.error, url: enrollment.url, name: enrollment.peer.name }).sentence : `${phaseOf(enrollment.lines)} ${percentOf({ lines: enrollment.lines, waitingAt: enrollment.waitingAt, now })}%`
  return <Row onClick={() => open(`adding:${enrollment.peer.name}`)} icon={<Mark icon={ServerStack01Icon} dot={failed ? 'bg-fail' : undefined} />} title={enrollment.peer.name} note={note}>
    {failed ? <Chevron /> : <Spinner className="mt-0" />}
  </Row>
}

function TailscaleStep() {
  const tailnet = useTailnet()
  const { start } = useEnroll()
  const recheck = () => void tailnet.refetch()
  const data = tailnet.data
  const add = (peer: Peer) => { void start({ name: peer.name, dns: peer.dns } satisfies TailnetPeer); open(`adding:${peer.name}`) }
  return <TailscaleDialog title="Add over Tailscale" back={<Button type="button" variant="secondary" onClick={() => open('add')}>Back</Button>}>
    {!data && <Scene mood="looking" title="Looking for your computers…" />}
    {data?.state === 'missing' && <Empty title="Install Tailscale" line="OpenHut uses it to find your other computers.">
      <a href={GET_TAILSCALE} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Get Tailscale</a>
      <Button type="button" variant="ghost" className={PILL} disabled={tailnet.isFetching} onClick={recheck}>Check again</Button>
    </Empty>}
    {data?.state === 'stopped' && <Empty title="Tailscale is off" line="Open it and sign in on this computer.">
      <Button type="button" variant="secondary" className={PILL} disabled={tailnet.isFetching} onClick={recheck}>Check again</Button>
    </Empty>}
    {data?.state === 'running' && <Peers peers={data.peers} tailnet={data.tailnet} recheck={recheck} checking={tailnet.isFetching} onAdd={add} />}
  </TailscaleDialog>
}

function Peers({ peers, tailnet, recheck, checking, onAdd }: { peers: Peer[]; tailnet: string; recheck: () => void; checking: boolean; onAdd: (peer: Peer) => void }) {
  const known = useKnown()
  const enrolling = new Set(useEnrollments().data.map((each) => each.peer.dns))
  const shown = byEligibility(peers).filter((peer) => stateOf(peer) === 'ready' || stateOf(peer) === 'ssh-off')
  const hidden = peers.length - shown.length
  if (!shown.length) return <Empty title="No Linux computers on your Tailscale yet" line="Install Tailscale on an always-on Linux computer and sign in with the same account.">
    <Button type="button" variant="secondary" className={PILL} disabled={checking} onClick={recheck}>Check again</Button>
  </Empty>
  return <div className="flex flex-col gap-1.5">
    <p className="m-0 px-2.5 text-body">Pick a Linux computer on {tailnet || 'your Tailscale'}.</p>
    <Rows>{shown.map((peer) => {
      const ready = stateOf(peer) === 'ready'
      const note = ['Linux', peer.ip, !ready && 'Tailscale SSH is off'].filter(Boolean).join(' · ')
      const icon = <I icon={ServerStack01Icon} size={20} className={ready ? 'text-hue-blue' : 'text-mute'} />
      return <Row key={peer.dns} icon={icon} title={peer.name} note={note}>
        {known(peer.name) && <Button type="button" variant="ghost" className={PILL} disabled><I icon={Tick02Icon} size={14} className="text-pass" />Added</Button>}
        {!known(peer.name) && enrolling.has(peer.dns) && <Button type="button" variant="ghost" className={PILL} onClick={() => open(`adding:${peer.name}`)}>Adding…</Button>}
        {!known(peer.name) && !enrolling.has(peer.dns) && <Button type="button" variant="secondary" className={PILL} onClick={() => ready ? onAdd(peer) : open(`ssh:${peer.name}`)}>{ready ? 'Add' : 'Turn on SSH'}</Button>}
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

function Waiting({ children, note }: { children: ReactNode; note: string }) {
  return <div className="flex flex-col gap-1">
    <p className="m-0 flex items-center gap-2"><Spinner className="mt-0" />{children}</p>
    <p className="m-0 pl-[22px] text-[12px]/[16px] text-mute">{note}</p>
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
  const known = useKnown()(name)
  const { start, dismiss } = useEnroll()
  const now = useNow(enrollment?.status === 'running')
  const hide = <Button type="button" variant="secondary" onClick={() => open()}>Hide</Button>
  const joined = known && !enrollment
  useEffect(() => { if (joined) open() }, [joined])
  if (joined) return null
  if (enrollment?.status === 'failed') {
    const retry = <Button type="button" variant="primary" onClick={() => void start(enrollment.peer)}>Try again</Button>
    const remove = <Button type="button" variant="secondary" onClick={() => { dismiss(enrollment.peer.dns); open() }}>Remove</Button>
    const details = detailsOf({ enrollment, version: APP_VERSION })
    return <TailscaleDialog title="Add over Tailscale" back={remove} foot={<><CopyButton text={details} label="Copy details" />{retry}</>}>
      <Scene mood="worried" title={`Couldn't add ${name}`} line={failureOf({ error: enrollment.error, url: enrollment.url, name }).sentence} />
      <details className="mx-2.5 rounded-lg border border-hair">
        <summary className="cursor-pointer px-3 py-2 text-mute select-none">Show details</summary>
        <pre className="m-0 max-h-40 overflow-auto border-t border-hair bg-tint px-3 py-2 font-mono text-[11px]/[1.6] whitespace-pre-wrap text-ink">{details}</pre>
      </details>
    </TailscaleDialog>
  }
  const stage = stageOf(enrollment?.lines ?? [])
  const percent = percentOf({ lines: enrollment?.lines ?? [], waitingAt: enrollment?.waitingAt, now })
  return <TailscaleDialog title="Add over Tailscale" back={hide} foot={<span className="text-[12px] text-mute">It keeps going if you close this.</span>}>
    <Scene mood="building" title={`Adding ${name}`} line={enrollment?.url
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
    <Rows>
      <Row onClick={() => open('tailscale')} icon={<Glyph name="tailscale" size={20} />} title="Tailscale" note="Use the Tailscale you already have. Nothing goes through OpenHut."><Chevron /></Row>
      <Row onClick={() => open('command')} icon={<Hut mood="looking" className="size-6" />} title="OpenHut Relay" note="The easiest way. No Tailscale needed. End-to-end encrypted."><Chevron /></Row>
    </Rows>
  </TailscaleDialog>
}

function AddByCommand() {
  const code = useMutation({ mutationFn: () => request({ schema: JoinCode, path: '/api/cloud/join-codes', method: 'POST' }) })
  const { mutate } = code
  useEffect(() => mutate(), [mutate])
  return <TailscaleDialog title="Add over OpenHut Relay" back={<Button type="button" variant="secondary" onClick={() => open('add')}>Back</Button>}>
    <ErrorNote message={code.error?.message} />
    {code.isPending && <Waiting note="It works once, for 10 minutes.">Making a code…</Waiting>}
    {code.data && <>
      <p className="m-0 text-body">Run this on your Linux computer.</p>
      <Command text={joinCommand(code.data.code)} />
      <Waiting note="It works once, for 10 minutes. Approve it here when it asks.">Waiting for it to ask to join…</Waiting>
    </>}
  </TailscaleDialog>
}

function joinCommand(code: string) {
  return `curl -fsSL openhut.dev | OPENHUT_JOIN='${code.replaceAll("'", '')}' sh`
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
