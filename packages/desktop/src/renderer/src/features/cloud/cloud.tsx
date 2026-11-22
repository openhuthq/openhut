import { useState, type FormEvent } from 'react'
import { CloudUploadIcon, FingerPrintIcon, Key01Icon, PlusSignIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import type { Backup, Cloud } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section, Status } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { DeviceIcon } from '@/components/custom/device'
import { ConfirmButton } from '@/components/confirm-button'
import { nameOf, REMOVE_DETAIL, useAddPasskey, useAllow, useCloud, useForget, usePasskeys, useRemoveMac, useSignIn, useSignOut } from '@/features/cloud/api'
import { markSeen } from '@/features/cloud/unlock'
import { CloudOff, SaveKit, TurnOn } from '@/features/cloud/sign-in'
import { HERE } from '@/features/settings/desktop'
import { Chevron, Row, Rows, useConfirming } from '@/features/settings/kit'
import { confirmed, isPhone, scan } from '@/lib/native'
import { ago, shortDate, shortDateTime } from '@/lib/format'
import { navigate, open, useOpen, useSearch } from '@/lib/router'
import { useDeleteData, useRotated } from '@/features/cloud/workspaces'
import { toastError } from '@/lib/toast'

export function CloudSettings() {
  const cloud = useCloud()
  const signOut = useSignOut()
  const helper = usePasskeys()
  const addPasskey = useAddPasskey()
  const kitOpen = useOpen() === 'kit'
  const error = new URLSearchParams(useSearch()).get('error') ?? cloud.error?.message
  const data = cloud.data
  if (!data) return <ErrorNote message={error} />
  if (data.status === 'off') return <>
    <CloudOff />
    <ErrorNote message={error ?? data.signInError ?? undefined} />
    {data.keptAccount && <KeptAccount email={data.keptAccount} />}
  </>
  const email = data.email ?? ''
  return <>
    <div className="flex items-center gap-3.5 px-1">
      <PersonFace name={nameOf(email)} email={email} size={48} />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[18px]/[1.2] font-semibold tracking-[-.01em]">{nameOf(email)}</span>{data.status === 'on' ? <span className="flex items-center gap-1.5 text-[12px] text-mute"><Google />{email}</span> : <span className="text-[12px] text-mute">Can't reach OpenHut Cloud. Your agents keep working.</span>}</span>
      {data.status === 'on' ? <Status tone="on">On</Status> : <Status tone="wait">Offline</Status>}
    </div>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      <div className="flex items-center gap-3 px-4 py-3"><I icon={CloudUploadIcon} size={18} className="text-hue-blue" /><span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Backup</span><span className={data.backup.problem || data.backup.state === 'failed' ? 'text-[12px] text-fail' : 'text-[12px] text-mute'}>{backupNote({ ...data.backup, offline: data.status === 'offline' })}</span></span></div>
      <div className="flex items-center gap-3 px-4 py-3"><I icon={SquareLock02Icon} size={18} className="text-hue-amber" /><span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Only your devices can read it</span><span className={data.kit?.differs ? 'text-[12px] text-fail' : 'text-[12px] text-mute'}>{kitNote(data.kit)}{data.keyStore === 'file' && ' · Keys in a file only you can read'}</span></span>{!data.youngUntil && <Button type="button" variant="secondary" className={PILL} onClick={() => open('kit')}>{data.kit ? 'Make a new kit' : 'Save a kit'}</Button>}</div>
      {helper?.passkeys && helper.prf && <div className="flex items-center gap-3 px-4 py-3"><I icon={FingerPrintIcon} size={18} className="text-hue-green" /><span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Passkey</span><span className="text-[12px] text-mute">{data.passkey ? `Touch ID unlocks a new ${HERE}` : `Unlock a new ${HERE} with Touch ID`}</span></span>{!data.passkey && !data.youngUntil && <Button type="button" variant="secondary" className={PILL} disabled={addPasskey.isPending} onClick={() => addPasskey.mutate(email, { onError: toastError })}>Add a passkey</Button>}</div>}
    </div>
    <div className="flex items-center gap-4 px-1">
      <span className="grid flex-1 gap-0.5"><span className="text-[13.5px] font-semibold">Sign out</span><span className="text-[12.5px] text-body">Your agents keep running on this {HERE}.</span></span>
      <Button type="button" variant="secondary" className={PILL} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out</Button>
    </div>
    <ErrorNote message={error ?? undefined} />
    {data.workspaces.some((each) => each.own) && <DeleteData cloud={data} />}
    {kitOpen && <SaveKit />}
  </>
}

function DeleteData({ cloud }: { cloud: Cloud }) {
  const opened = useOpen() === 'delete-data'
  const shared = cloud.workspaces.find((each) => !each.own && each.role === 'owner' && each.members.length > 1)
  const joined = cloud.workspaces.filter((each) => !each.own).map((each) => each.name)
  return <section className="mt-4 flex flex-col gap-2.5">
    <span className="px-1 text-[13.5px] font-semibold">Danger zone</span>
    <div className="flex items-center gap-4 px-1 py-1">
      <span className="grid flex-1 gap-0.5"><span className="text-[13.5px] font-semibold">Delete your cloud data</span><span className="text-[12.5px] text-body">{shared ? `Hand over or delete ${shared.name} first.` : `Backups and sync stop for good. Your ${HERE}s keep their copy.`}</span></span>
      <Button type="button" variant="danger" disabled={Boolean(shared)} className="h-8 shrink-0 rounded-md border border-hair px-3 text-[12.5px]" onClick={() => open('delete-data')}>Delete cloud data</Button>
    </div>
    {opened && !shared && <DeleteDataConfirm joined={joined} />}
  </section>
}

function DeleteDataConfirm({ joined }: { joined: string[] }) {
  const remove = useDeleteData()
  const close = () => open()
  const leave = joined.length ? `, and you leave ${joined.join(', ')}` : ''
  return <Dialog size="narrow" label="Delete your cloud data?" onClose={close}>
    <DialogHead title="Delete your cloud data?" onClose={close} />
    <div className="px-5 py-5 text-[13px]/[18px] text-body">Your backup and keys leave OpenHut Cloud{leave}. This {HERE} keeps its agents.</div>
    <DialogFoot error={remove.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: close })}>{remove.isPending ? 'Deleting…' : 'Delete'}</Button></DialogFoot>
  </Dialog>
}

function RotateConnections({ rotate }: { rotate: Cloud['rotate'] }) {
  const done = useRotated()
  return <Section title="Connections to rotate" action={<Button type="button" variant="ghost" className={PILL} disabled={done.isPending} onClick={() => done.mutate(undefined, { onError: toastError })}>Done</Button>}>
    <Rows>{rotate.map((each) => <Row key={each.id} icon={<I icon={Key01Icon} size={18} className="text-hue-amber" />} title={each.name} note={`The device you removed could read this ${each.kind} key. Make a new one at the service.`} onClick={() => navigate('/connections')}><Chevron /></Row>)}</Rows>
  </Section>
}

function KeptAccount({ email }: { email: string }) {
  const forget = useForget()
  const { confirming, setConfirming, box } = useConfirming()
  return <div ref={box}><Row icon={<PersonFace name={nameOf(email)} email={email} size={32} />} title={nameOf(email)} note={confirming ? `Removes its keys from this ${HERE}. Your recovery words bring it back.` : email}>
    {confirming
      ? <>
        <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(false)}>Cancel</Button>
        <Button type="button" variant="danger" className={PILL} disabled={forget.isPending} onClick={() => forget.mutate(undefined, { onError: toastError })}>Forget</Button>
      </>
      : <Button type="button" variant="danger" className={PILL} onClick={() => setConfirming(true)}>Forget</Button>}
  </Row></div>
}

const addedAt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

export function CloudDevices() {
  const cloud = useCloud().data
  const signIn = useSignIn()
  const remove = useRemoveMac()
  if (cloud?.status === 'on' || cloud?.status === 'offline') return <>
    {cloud.rotate.length > 0 && <RotateConnections rotate={cloud.rotate} />}
    {cloud.devices.map((device) => <Row key={device.key} icon={<DeviceIcon kind={device.kind} />} title={device.name ?? (device.kind === 'server' ? 'Computer that runs agents' : 'Mac')} note={[device.here && (isPhone() ? `Your ${HERE}` : `This ${HERE}`), device.addedAt && `Added ${addedAt.format(new Date(device.addedAt))}`].filter(Boolean).join(' · ')}>
      {!device.here && !isPhone() && !cloud.youngUntil && <ConfirmButton className={PILL} disabled={remove.isPending} question={`Remove ${device.name ?? 'this device'}?`} detail={device.addedAt ? `Added ${shortDateTime.format(new Date(device.addedAt))}. ${REMOVE_DETAIL}` : REMOVE_DETAIL} action="Remove" onConfirm={() => remove.mutate(device.key)}>Remove</ConfirmButton>}
    </Row>)}
    {cloud.youngUntil && <p className="m-0 px-1 text-[12.5px] text-mute">This {HERE} was added less than 3 days ago. You can remove devices from it after {shortDate.format(new Date(cloud.youngUntil))}.</p>}
    <Row onClick={() => open('add-mac')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-blue" />} title="Add a Mac" note={`Unlock OpenHut on your new Mac with this ${isPhone() ? 'phone' : 'one'}.`}><Chevron /></Row>
  </>
  if (cloud?.status !== 'off' || isPhone()) return null
  return <Row icon={<I icon={SquareLock02Icon} size={20} className="text-mute" />} title="Chat from your other computers" note="Needs OpenHut Cloud"><TurnOn short pending={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })} /></Row>
}

function backupNote({ state, done, total, at, problem, offline }: Backup & { offline: boolean }): string {
  if (problem) return problem
  if (state === 'backing_up') return `Backing up · ${done} of ${total}`
  if (state === 'restoring') return 'Restoring…'
  if (state === 'failed') return `Couldn’t back up ${total - done} of ${total} · Trying again`
  if (offline) return at ? `Last backup ${ago(at)} ago` : `Agents and settings, locked on this ${HERE} first`
  return at ? `Up to date · ${ago(at)} ago` : `Agents and settings, locked on this ${HERE} first`
}

function kitNote(kit: Cloud['kit']): string {
  if (kit?.differs) return `Your recovery kit in OpenHut Cloud isn’t the one this ${HERE} saved. Make a new kit.`
  return kit ? `Recovery kit saved ${shortDate.format(new Date(kit.savedAt))}` : 'No recovery kit'
}

function Google() {
  return <svg width={12} height={12} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}

export function AddMac() {
  const allow = useAllow()
  const [added, setAdded] = useState(false)
  const close = () => open()
  const send = (code: string) => void confirmed(`Add this ${HERE}`).then((ok) => { if (ok) allow.mutate(code, { onSuccess: ({ devices }) => { markSeen(devices); setAdded(true) } }) })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    send(String(new FormData(event.currentTarget).get('code') ?? ''))
  }
  return <Dialog size="narrow" label="Add a Mac" onClose={close}>
    <DialogHead title="Add a Mac" onClose={close} />
    <form id="add-mac" onSubmit={submit} className="flex flex-col gap-4 px-5 py-5 text-[13px]/[18px]">
      {added ? <p className="m-0 text-body">Added. The new {HERE} is unlocking now and gets your agents, chats and keys.</p> : <>
        <p className="m-0 text-body">On the new Mac, pick Use my iPhone or another Mac. Then {isPhone() ? 'scan the code it shows, or type it' : 'type the code it shows'}.</p>
        {isPhone() && <Button type="button" variant="primary" className="h-12 justify-center rounded-xl" onClick={() => void scan().then((text) => { if (text) send(text) }, toastError)}>Scan the code</Button>}
        <Input name="code" aria-label="Code" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-X" autoFocus={!isPhone()} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono phone:h-11" />
        <div className="flex gap-2.5 rounded-lg bg-[oklch(97%_0.03_60)] px-3.5 py-3 text-[oklch(40%_0.1_50)]"><I icon={SquareLock02Icon} size={16} className="mt-px shrink-0" /><span>Add only a {HERE} in front of you that's yours. If someone asked you to do this, on a call, by email or in chat, it's a scam.</span></div>
        <ErrorNote message={allow.error?.message} />
      </>}
    </form>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={close}>{added ? 'Done' : 'Cancel'}</Button>}>{!added && <Button type="submit" form="add-mac" variant="primary" disabled={allow.isPending}>{allow.isPending ? 'Adding…' : `Add this ${HERE}`}</Button>}</DialogFoot>
  </Dialog>
}
