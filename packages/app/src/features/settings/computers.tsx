import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CloudIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import type { Admin } from '@openhut/common/admin/admin.ts'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/confirm-button'
import { DEVICE_HUE, DEVICE_ICONS, DeviceIcon } from '@/components/custom/device'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { I, PILL, Status } from '@/components/kit'
import { useAgents } from '@/features/agents/api'
import { useComputerAdmins, useComputers, useUpdateComputer } from '@/features/computers/api'
import { Chevron, Command, Intro, Row, Rows } from '@/features/settings/kit'
import { KeysToReplace } from '@/features/cloud/cloud'
import { CLOUD_NOTE, LOST_POINTS, REMOVE_DETAIL, REMOVE_POINTS, useCloud, useCloudComputer, useRemoveMac } from '@/features/cloud/api'
import { request } from '@/lib/api-client'
import { shortDate } from '@/lib/format'
import type { Computer } from '@/lib/openhut'
import { open, useOpen } from '@/lib/router'
import { toastError, toastInfo } from '@/lib/toast'
import type { Mood } from '@/lib/hut'
import { isBrowser, tunnelKeyOf } from '@/lib/computers'
import { remote } from '@/lib/remote'
import { iconOf } from '@/features/computers/computer-picker'
import { cn } from '@/lib/utils'

const JoinCode = z.object({ code: z.string(), expiresAt: z.string() })

type Device = Cloud['devices'][number]

export function ComputersSettings() {
  return <>
    <ComputerList />
    {useOpen() === 'add' && <Dialog size="narrow" onClose={() => open()}><AddByCommand /></Dialog>}
  </>
}

function ComputerList() {
  const computers = useComputers()
  const admins = useComputerAdmins().data
  const agents = useAgents().data ?? []
  const { devices } = mineOf(useCloud().data)
  const local = computers.data?.[0]
  const admin = admins?.find((each) => each.computer.id === local?.id)?.admin
  const here = devices.find((device) => device.here)
  const current = useQuery({ queryKey: ['browser-key'], queryFn: remote.deviceKey, staleTime: Infinity }).data
  const others = devices.filter((device) => !device.here)
  const cloudComputer = useCloudComputer().data
  const localIsCloud = !!cloudComputer?.device && here?.key === cloudComputer.device
  const browsers = others.filter(isBrowser)
  return <>
    <KeysToReplace />
    <Intro>Your computers</Intro>
    <ErrorNote message={computers.error?.message} />
    <Rows>
      {local && !localIsCloud && admin?.server.update?.status === 'running' && <Row icon={<ComputerMark computer={local} />} title={here?.name ?? local.name} note="Updating…"><Spinner className="mt-0" /></Row>}
      {local && !localIsCloud && admin?.server.update?.status !== 'running' && <Row icon={<ComputerMark computer={local} />} title={here?.name ?? local.name} note={noteOf({ computer: local, admin, count: agents.filter((agent) => agent.runsHere).length, device: here })} />}
      {cloudComputer && <CloudRow state={cloudComputer.state} />}
      {others.filter((device) => !isBrowser(device) && device.key !== cloudComputer?.device).map((device) => <DeviceRow key={device.key} device={device} twin={devices.some((each) => each.key !== device.key && each.name === device.name)} admin={admins?.find((each) => each.computer.id === tunnelKeyOf(device.key))?.admin} />)}
      <Row onClick={() => open('add')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-green" />} title="Add a computer" note="Add a Linux server. It stays on and seals each agent in its own box."><Chevron /></Row>
    </Rows>
    {browsers.length > 0 && <>
      <Intro>Browsers</Intro>
      <Rows>{browsers.map((device) => <DeviceRow key={device.key} device={device} current={device.key === current} twin={false} admin={undefined} />)}</Rows>
    </>}
  </>
}

// C3: the Cloud computer pauses when idle and wakes on a message.
function CloudRow({ state }: { state: string }) {
  const shown = state === 'running' ? <Status tone="on">Running</Status> : <span className="text-[13px] text-mute">{state === 'waking' ? 'Waking…' : state === 'creating' ? 'Starting…' : state === 'out' ? 'Out of credits' : 'Paused'}</span>
  return <Row icon={<I icon={CloudIcon} size={20} className="text-hue-sky" />} title="Cloud" note={CLOUD_NOTE}>{shown}</Row>
}

function mineOf(cloud: Cloud | undefined): { devices: Device[] } {
  return { devices: cloud?.status === 'on' || cloud?.status === 'offline' ? cloud.devices : [] }
}

function noteOf({ computer, admin, count, device }: { computer: Computer; admin: Admin | undefined; count: number; device: Device | undefined }) {
  if (!computer.online) return 'Offline'
  const failed = admin?.server.update?.status === 'failed' ? admin.server.update : null
  if (failed) return `Couldn't update to ${failed.to}. ${sentence(failed.reason ?? 'The update stopped before it finished.')}`
  const server = device?.kind === 'server'
  return [server ? 'Linux server · connected now' : 'Connected now', agentCount(count), admin && `OpenHut ${admin.server.version}`].filter(Boolean).join(' · ')
}

function sentence(text: string) {
  const trimmed = text.trim()
  const first = trimmed.startsWith('macOS') ? trimmed.charAt(0) : trimmed.charAt(0).toUpperCase()
  return `${first}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? '' : '.'}`
}

function agentCount(count: number) {
  if (!count) return 'No agents'
  return `${count} agent${count === 1 ? '' : 's'}`
}

export function ComputerMark({ computer }: { computer: Computer }) {
  return <Mark icon={iconOf(computer)} dot={computer.online ? 'bg-pass' : 'bg-mute-2'} />
}

function Mark({ icon, dot }: { icon: typeof DEVICE_ICONS.mac; dot?: string }) {
  return <span className="relative inline-grid place-items-center">
    <I icon={icon} size={20} className={DEVICE_HUE} />
    {dot && <i className={cn('absolute -right-1 -bottom-0.5 size-2.5 rounded-full border-2 border-card', dot)} />}
  </span>
}

function DeviceRow({ device, twin, admin, current }: { device: Device; twin: boolean; admin: Admin | undefined; current?: boolean }) {
  const remove = useRemoveMac()
  const update = useUpdateComputer()
  const server = device.kind === 'server'
  const base = device.name ?? (server ? 'Computer that runs agents' : 'Computer')
  const name = twin ? `${base} (${tunnelKeyOf(device.key).slice(0, 4)})` : base
  const detail = device.addedAt ? `Added ${shortDate.format(new Date(device.addedAt))} · ${REMOVE_DETAIL}` : REMOVE_DETAIL
  const browser = isBrowser(device)
  return <Row icon={<DeviceIcon kind={browser ? 'browser' : device.kind} />} title={name} note={sentence([current ? 'This browser' : device.os === 'web' ? null : device.os ?? (server ? 'Linux' : null), server && 'Server · runs agents', !browser && presenceOf(device), admin && `OpenHut ${admin.server.version}`].filter(Boolean).join(' · ')).replace(/\.$/, '')}>
    {server && update.isPending && <span className="inline-flex items-center gap-1.5"><Spinner className="mt-0" />Updating…</span>}
    {server && !update.isPending && admin?.server.updateAvailable && <Button type="button" variant="secondary" className={PILL} onClick={() => update.mutate({ id: tunnelKeyOf(device.key), name }, { onSuccess: () => toastInfo(`${name} is updating`), onError: toastError })}>Update</Button>}
    <ConfirmButton variant="secondary" className={cn(PILL, 'text-fail')} disabled={remove.isPending} question={`Remove ${name}?`} detail={detail} points={REMOVE_POINTS} action="Remove" onConfirm={() => remove.mutate({ key: device.key })}>Remove</ConfirmButton>
    <ConfirmButton variant="secondary" className={cn(PILL, 'text-fail')} disabled={remove.isPending} question={`${name} is lost or stolen?`} detail="Remove it and lock it out." points={LOST_POINTS} action="Remove and lock out" onConfirm={() => remove.mutate({ key: device.key, lost: true })}>Lost or stolen</ConfirmButton>
  </Row>
}

const JOINING_MS = 10 * 60_000

function presenceOf(device: Device): string {
  if (device.online) return 'Online'
  return !device.heard && device.addedAt && Date.now() - Date.parse(device.addedAt) < JOINING_MS ? 'Connecting…' : 'Offline'
}

export function Scene({ mood, title, line, children }: { mood: Mood; title: string; line?: ReactNode; children?: ReactNode }) {
  return <div className="flex flex-col items-center gap-4 px-6 pt-4 pb-2 text-center">
    {children ?? <Hut mood={mood} className="size-24" />}
    <div className="flex flex-col gap-1">
      <span className="text-[15px]/[22px] font-medium">{title}</span>
      {line && <span className="max-w-[400px] text-balance text-mute">{line}</span>}
    </div>
  </div>
}

export function Waiting({ children, note }: { children: ReactNode; note: string }) {
  return <div className="flex flex-col gap-1">
    <p className="m-0 flex items-center gap-2"><Spinner className="mt-0" />{children}</p>
    <p className="m-0 pl-[22px] text-[12px]/[16px] text-mute">{note}</p>
  </div>
}

function Step({ title, back, foot, children }: { title: string; back?: ReactNode; foot?: ReactNode; children: ReactNode }) {
  return <>
    <DialogHead title={title} onClose={() => open()} />
    <div className="flex max-h-[min(480px,calc(100vh-200px))] flex-col gap-4 overflow-y-auto px-3 py-5 text-[13px]/[18px]">{children}</div>
    {(back || foot) && <DialogFoot start={back}>{foot}</DialogFoot>}
  </>
}

function AddByCommand() {
  const code = useMutation({ mutationFn: () => request({ schema: JoinCode, path: '/api/cloud/join-codes', method: 'POST' }) })
  const { mutate } = code
  useEffect(() => mutate(), [mutate])
  const now = useNow(Boolean(code.data))
  const expired = code.data && now > Date.parse(code.data.expiresAt)
  return <Step title="Add a computer" foot={expired && <Button type="button" variant="primary" onClick={() => mutate()}>Make a new command</Button>}>
    <ErrorNote message={code.error?.message} />
    {code.isPending && <Waiting note="It works once, for 10 minutes.">Making a code…</Waiting>}
    {expired && <Scene mood="worried" title="This command expired" line="Make a new one and run it on your server." />}
    {code.data && !expired && <>
      <p className="m-0 text-body">Run this on your Linux computer.</p>
      <Command text={joinCommand(code.data.code)} />
      <p className="m-0 text-[12px]/[16px] text-mute">Ubuntu, Debian or Alpine with sudo. It installs Docker if needed and takes about 2 GB. Every download is checked against its checksum. You can <a href="https://github.com/openhuthq/openhut/blob/main/install/install.sh" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">read the script</a> first.</p>
      <Waiting note="It works once, for 10 minutes. It shows up here once it joins.">Waiting for your server…</Waiting>
    </>}
  </Step>
}

export function joinCommand(code: string) {
  return `curl -fsSL openhut.dev | OPENHUT_JOIN='${code.replaceAll("'", '')}' sh`
}

export function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [ticking])
  return now
}
