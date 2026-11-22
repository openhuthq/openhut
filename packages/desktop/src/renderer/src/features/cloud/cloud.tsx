import { useState, type FormEvent } from 'react'
import { CloudUploadIcon, Delete02Icon, FingerPrintIcon, Key01Icon, Logout03Icon, PlusSignIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import type { Backup, Cloud } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section, Status } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { DeviceIcon } from '@/components/custom/device'
import { notify } from '@/components/custom/toast'
import { ConfirmButton } from '@/components/confirm-button'
import { nameOf, REMOVE_DETAIL, useAddPasskey, useAllow, useCloud, useForget, usePasskeys, useRemoveMac, useSignOut } from '@/features/cloud/api'
import { markSeen } from '@/features/cloud/seen'
import { EnableCloud, Pitch } from '@/features/cloud/sign-in'
import { CloudSetup, KitDialog } from '@/features/cloud/setup'
import { HERE } from '@/features/settings/desktop'
import { Chevron, Row, Rows, useConfirming } from '@/features/settings/kit'
import { isPhone, scan, useConfirmed } from '@/lib/native'
import { ago, shortDate, shortDateTime } from '@/lib/format'
import { navigate, open, useOpen, useSearch } from '@/lib/router'
import { useDeleteData, useRotated } from '@/features/cloud/workspaces'
import { toastError } from '@/lib/toast'

export function BackupSettings() {
  const cloud = useCloud()
  const opened = useOpen()
  const error = new URLSearchParams(useSearch()).get('error') ?? cloud.error?.message
  const data = cloud.data
  if (!data) return <ErrorNote message={error} />
  const on = data.status === 'on' || data.status === 'offline'
  return <>
    {on ? <CloudOn cloud={data} error={error ?? undefined} /> : <Pitch door="backup" />}
    {data.status === 'off' && <ErrorNote message={error ?? undefined} />}
    {data.status === 'off' && data.keptAccount && <KeptAccount email={data.keptAccount} />}
    {opened === 'enable' && <CloudSetup />}
    {opened === 'kit' && data.status !== 'off' && <KitDialog />}
  </>
}

function CloudOn({ cloud, error }: { cloud: Cloud; error?: string }) {
  const signOut = useSignOut()
  const helper = usePasskeys()
  const addPasskey = useAddPasskey()
  const email = cloud.email ?? ''
  const young = Boolean(cloud.youngUntil)
  return <>
    <div className="flex items-center gap-3.5 px-1">
      <PersonFace name={nameOf(email)} email={email} size={48} />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[18px]/[1.2] font-semibold tracking-[-.01em]">{nameOf(email)}</span>{cloud.status === 'on' ? <span className="flex items-center gap-1.5 text-[12px] text-mute"><Google />{email}</span> : <span className="text-[12px] text-mute">Offline. Agents keep working.</span>}</span>
      {cloud.status === 'on' ? <Status tone="on">On</Status> : <Status tone="wait">Offline</Status>}
    </div>
    <Rows>
      <Row icon={<I icon={CloudUploadIcon} size={20} className="text-hue-blue" />} title="Backup" note={<span className={cloud.backup.problem || cloud.backup.state === 'failed' ? 'text-fail' : undefined}>{backupNote({ ...cloud.backup, offline: cloud.status === 'offline' })}</span>} />
      <Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Recovery kit" note={<span className={cloud.kit?.differs ? 'text-fail' : undefined}>{kitNote(cloud.kit)}{cloud.keyStore === 'file' && ' · Keys in a private file'}</span>}>
        {!young && <Button type="button" variant={cloud.kit ? 'secondary' : 'primary'} className={PILL} onClick={() => open(cloud.kit ? 'kit' : 'enable')}>{cloud.kit ? 'Make a new kit' : 'Save kit'}</Button>}
      </Row>
      {helper?.passkeys && helper.prf && <Row icon={<I icon={FingerPrintIcon} size={20} className="text-hue-green" />} title="Touch ID" note={cloud.passkey ? 'On' : `Unlock a new ${HERE}`}>
        {!cloud.passkey && !young && <Button type="button" variant="secondary" className={PILL} disabled={addPasskey.isPending} onClick={() => addPasskey.mutate(email, { onError: toastError })}>Add</Button>}
      </Row>}
      <Row icon={<I icon={Logout03Icon} size={20} className="text-hue-slate" />} title="Sign out" note="Agents keep running">
        <Button type="button" variant="secondary" className={PILL} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out</Button>
      </Row>
    </Rows>
    <ErrorNote message={error} />
    {cloud.workspaces.some((each) => each.own) && <DeleteAccount cloud={cloud} />}
  </>
}

function DeleteAccount({ cloud }: { cloud: Cloud }) {
  const remove = useDeleteData()
  const teams = cloud.workspaces.filter((each) => !each.own)
  const shared = teams.find((each) => each.role === 'owner' && each.members.length > 1)
  const deleted = teams.filter((each) => each.role === 'owner').map((each) => each.name)
  const left = teams.filter((each) => each.role !== 'owner').map((each) => each.name)
  const detail = [
    `This deletes your cloud copy of your agents, chats and settings, your devices list, your recovery kit${cloud.passkey ? ' and Touch ID' : ''}, and your sign-in.`,
    deleted.length > 0 && `${list(deleted)} ${deleted.length > 1 ? 'are' : 'is'} deleted too.`,
    left.length > 0 && `You leave ${list(left)}.`,
    `Your other devices lose access to the cloud. This ${HERE} signs out and keeps its agents and chats. You can’t undo this.`,
  ].filter(Boolean).join(' ')
  return <Section title="Danger zone">
    <Rows>
      <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete cloud account" note={deleteNote({ cloud, shared: shared?.name })}>
        <ConfirmButton className={PILL} disabled={Boolean(shared || cloud.youngUntil) || remove.isPending} question="Delete your cloud account?" detail={detail} action="Delete account" onConfirm={() => remove.mutate(undefined, { onSuccess: () => notify({ title: 'Cloud account deleted', note: `This ${HERE} keeps its agents and chats.` }), onError: toastError })}>{remove.isPending ? 'Deleting…' : 'Delete account'}</ConfirmButton>
      </Row>
    </Rows>
  </Section>
}

function deleteNote({ cloud, shared }: { cloud: Cloud; shared?: string }): string {
  if (cloud.youngUntil) return `This ${HERE} was added less than 3 days ago. Delete from an older device, or after ${shortDate.format(new Date(cloud.youngUntil))}.`
  if (shared) return `You own ${shared}, which has other people in it. Make someone else its owner or delete it first.`
  return `Removes everything you keep in OpenHut Cloud. This ${HERE} keeps its agents.`
}

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? ''
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
  return <Row icon={<I icon={SquareLock02Icon} size={20} className="text-mute" />} title="Chat from your other computers" note="Needs OpenHut Cloud"><EnableCloud /></Row>
}

function backupNote({ state, done, total, at, problem, offline }: Backup & { offline: boolean }): string {
  if (problem) return problem
  if (state === 'backing_up') return `Backing up · ${done} of ${total}`
  if (state === 'restoring') return total ? `Bringing your agents back · ${Math.min(done + 1, total)} of ${total}` : 'Bringing your agents back…'
  if (state === 'failed') return `Couldn’t back up ${total - done} of ${total} · Trying again`
  if (offline) return at ? `Last backup ${ago(at)} ago` : `Agents and settings, locked on this ${HERE} first`
  return at ? `Up to date · ${ago(at)} ago` : `Agents and settings, locked on this ${HERE} first`
}

function kitNote(kit: Cloud['kit']): string {
  if (kit?.differs) return 'Out of date. Make a new kit.'
  return kit ? `Saved ${shortDate.format(new Date(kit.savedAt))}` : 'Not saved'
}

function Google() {
  return <svg width={12} height={12} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}

export function AddMac() {
  const allow = useAllow()
  const [added, setAdded] = useState(false)
  const { asking, confirm } = useConfirmed()
  const close = () => open()
  const send = (code: string) => void confirm(`Add this ${HERE}`).then((ok) => { if (ok) allow.mutate(code, { onSuccess: ({ devices }) => { markSeen(devices); setAdded(true) } }) })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    send(String(new FormData(event.currentTarget).get('code') ?? ''))
  }
  return <Dialog size="narrow" label="Add a Mac" onClose={close}>
    <DialogHead title="Add a Mac" onClose={close} />
    <form id="add-mac" onSubmit={submit} className="flex flex-col gap-4 px-5 py-5 text-[13px]/[18px]">
      {added ? <p className="m-0 text-body">Added. The new {HERE} is unlocking now and gets your agents, chats and keys.</p> : <>
        <p className="m-0 text-body">On the new Mac, pick Use my iPhone or another Mac. Then {isPhone() ? 'scan the code it shows, or type it' : 'type the code it shows'}.</p>
        {isPhone() && <Button type="button" variant="primary" className="h-12 justify-center rounded-xl" disabled={asking || allow.isPending} onClick={() => void scan().then((text) => { if (text) send(text) }, toastError)}>Scan the code</Button>}
        <Input name="code" aria-label="Code" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-X" autoFocus={!isPhone()} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono phone:h-11" />
        <div className="flex gap-2.5 rounded-lg bg-[oklch(97%_0.03_60)] px-3.5 py-3 text-[oklch(40%_0.1_50)]"><I icon={SquareLock02Icon} size={16} className="mt-px shrink-0" /><span>Add only a {HERE} in front of you that's yours. If someone asked you to do this, on a call, by email or in chat, it's a scam.</span></div>
        <ErrorNote message={allow.error?.message} />
      </>}
    </form>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={close}>{added ? 'Done' : 'Cancel'}</Button>}>{!added && <Button type="submit" form="add-mac" variant="primary" disabled={asking || allow.isPending}>{allow.isPending ? 'Adding…' : `Add this ${HERE}`}</Button>}</DialogFoot>
  </Dialog>
}
