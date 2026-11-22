import { useState, type FormEvent, type ReactNode } from 'react'
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
import { nameOf, REMOVE_DETAIL, useAddPasskey, useAllow, useCloud, usePasskeys, useRemoveMac, useSignOut } from '@/features/cloud/api'
import { markSeen } from '@/features/cloud/seen'
import { EnableCloud, SignInOnTeam } from '@/features/cloud/sign-in'
import { CloudSetup, KitDialog } from '@/features/cloud/setup'
import { Chevron, Row, Rows } from '@/features/settings/kit'
import { isPhone, scan, useConfirmed } from '@/lib/native'
import { ago, shortDate, shortDateTime } from '@/lib/format'
import { navigate, open, useOpen, useSearch } from '@/lib/router'
import { useDeleteData, useRotated } from '@/features/cloud/workspaces'
import { YourTeams } from '@/features/people/workspace'
import { toastError } from '@/lib/toast'

export function AccountSettings() {
  const cloud = useCloud()
  const opened = useOpen()
  const error = new URLSearchParams(useSearch()).get('error') ?? cloud.error?.message
  const data = cloud.data
  if (!data) return <ErrorNote message={error} />
  const on = data.status === 'on' || data.status === 'offline'
  return <>
    {on ? <CloudOn cloud={data} error={error ?? undefined} /> : data.status === 'locked' && !isPhone() ? <CloudLocked cloud={data} /> : <SignInOnTeam what="your account" />}
    {data.status === 'off' && <ErrorNote message={error ?? undefined} />}
    {opened === 'enable' && <CloudSetup />}
    {opened === 'kit' && data.status !== 'off' && <KitDialog />}
  </>
}

function CloudLocked({ cloud }: { cloud: Cloud }) {
  const email = cloud.email ?? ''
  return <>
    <AccountHead email={email} note={<span className="flex items-center gap-1.5 text-[12px] text-mute"><Google />{email}</span>} status={<Status tone="off">Locked</Status>} />
    <Rows>
      <Row icon={<I icon={SquareLock02Icon} size={20} className="text-hue-amber" />} title="Locked on this computer" note="Unlock to restore your agents and chats">
        <Button type="button" variant="primary" className={PILL} onClick={() => open('enable')}>Unlock</Button>
      </Row>
      <SignOutRow />
    </Rows>
    <Section title="Danger zone">
      <Rows>
        <LockedDelete />
      </Rows>
    </Section>
  </>
}

function LockedDelete() {
  const remove = useDeleteData()
  return <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete account" note={<span className="text-fail">{DELETE_NOTE}</span>}>
    <ConfirmButton className={PILL} disabled={remove.isPending} question="Delete your account?" detail="Your agents and chats stay on this computer. You can’t undo this." list={['Your backup of agents, chats and settings', 'Your recovery kit and sign-in']} action="Delete account" typed="delete my account" onConfirm={() => remove.mutateAsync().then(accountDeleted)}>{remove.isPending ? 'Deleting…' : 'Delete account'}</ConfirmButton>
  </Row>
}

function AccountHead({ email, note, status }: { email: string; note: ReactNode; status: ReactNode }) {
  return <div className="flex items-center gap-3.5 px-1">
    <PersonFace name={nameOf(email)} email={email} size={48} />
    <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[18px]/[1.2] font-semibold tracking-[-.01em]">{nameOf(email)}</span>{note}</span>
    {status}
  </div>
}

function SignOutRow() {
  const signOut = useSignOut()
  return <Row icon={<I icon={Logout03Icon} size={20} className="text-hue-slate" />} title="Sign out" note="Your agents keep running on this computer">
    <Button type="button" variant="ghost" className={PILL} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out</Button>
  </Row>
}

function CloudOn({ cloud, error }: { cloud: Cloud; error?: string }) {
  const helper = usePasskeys()
  const addPasskey = useAddPasskey()
  const email = cloud.email ?? ''
  const young = Boolean(cloud.youngUntil)
  return <>
    <AccountHead email={email} note={cloud.status === 'on' ? <span className="flex items-center gap-1.5 text-[12px] text-mute"><Google />{email}</span> : <span className="text-[12px] text-mute">Can’t reach the cloud. Your agents keep working.</span>} status={cloud.status === 'on' ? <Status tone="on">On</Status> : <Status tone="wait">Offline</Status>} />
    <YourTeams />
    <Rows>
      <Row icon={<I icon={CloudUploadIcon} size={20} className="text-hue-blue" />} title="Backup" note={<span className={cloud.backup.problem || cloud.backup.state === 'failed' ? 'text-fail' : undefined}>{backupNote({ ...cloud.backup, offline: cloud.status === 'offline' })}</span>} />
      <Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Recovery kit" note={<span className={cloud.kit?.differs ? 'text-fail' : undefined}>{kitNote(cloud.kit)}{cloud.keyStore === 'file' && ' · Stored in a file, not the keychain'}</span>}>
        {!young && <Button type="button" variant={cloud.kit ? 'ghost' : 'primary'} className={PILL} onClick={() => open(cloud.kit ? 'kit' : 'enable')}>{cloud.kit ? 'Make a new kit' : 'Save kit'}</Button>}
      </Row>
      {helper?.passkeys && helper.prf && <Row icon={<I icon={FingerPrintIcon} size={20} className="text-hue-green" />} title="Touch ID" note={cloud.passkey ? 'On' : 'Unlock a new Mac with your fingerprint'}>
        {!cloud.passkey && !young && <Button type="button" variant="ghost" className={PILL} disabled={addPasskey.isPending} onClick={() => addPasskey.mutate(email, { onError: toastError })}>Add</Button>}
      </Row>}
      <SignOutRow />
    </Rows>
    <ErrorNote message={error} />
    <Section title="Danger zone">
      <Rows>
        <DeleteAccount cloud={cloud} />
      </Rows>
    </Section>
  </>
}

function DeleteAccount({ cloud }: { cloud: Cloud }) {
  const remove = useDeleteData()
  const teams = cloud.workspaces.filter((each) => !each.own)
  const shared = teams.find((each) => each.role === 'owner' && each.members.length > 1)
  const deleted = teams.filter((each) => each.role === 'owner').map((each) => each.name)
  const left = teams.filter((each) => each.role !== 'owner').map((each) => each.name)
  const gone = [
    'Your backup of agents, chats and settings',
    cloud.passkey ? 'Your recovery kit, Touch ID and sign-in' : 'Your recovery kit and sign-in',
    'Access from your other devices',
    deleted.length > 0 && `${list(deleted)} ${deleted.length > 1 ? 'workspaces' : 'workspace'}`,
    left.length > 0 && `Your place in ${list(left)}`,
  ].filter((item): item is string => Boolean(item))
  return <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete account" note={deleteNote({ cloud, shared: shared?.name })}>
    <ConfirmButton className={PILL} disabled={Boolean(shared || cloud.youngUntil) || remove.isPending} question="Delete your account?" detail="Your agents and chats stay on this computer. You can’t undo this." list={gone} action="Delete account" typed="delete my account" onConfirm={() => remove.mutateAsync().then(accountDeleted)}>{remove.isPending ? 'Deleting…' : 'Delete account'}</ConfirmButton>
  </Row>
}

const DELETE_NOTE = 'Deletes your backup and sign-in. Agents on this computer stay.'

function accountDeleted() {
  notify({ title: 'Account deleted', note: 'Your agents and chats stay on this computer.' })
}

function deleteNote({ cloud, shared }: { cloud: Cloud; shared?: string }): string {
  if (cloud.youngUntil) return `This computer was added less than 3 days ago. Delete your account from an older one, or after ${shortDate.format(new Date(cloud.youngUntil))}.`
  if (shared) return `You own ${shared}, and other people are in it. Make someone else the owner, or delete it first.`
  return DELETE_NOTE
}

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? ''
}

function RotateConnections({ rotate }: { rotate: Cloud['rotate'] }) {
  const done = useRotated()
  return <Section title="Keys to replace" action={<Button type="button" variant="ghost" className={PILL} disabled={done.isPending} onClick={() => done.mutate(undefined, { onError: toastError })}>Done</Button>}>
    <Rows>{rotate.map((each) => <Row key={each.id} icon={<I icon={Key01Icon} size={18} className="text-hue-amber" />} title={each.name} note={`The device you removed could read this ${each.kind} key. Make a new one at the service.`} onClick={() => navigate('/connections')}><Chevron /></Row>)}</Rows>
  </Section>
}

const addedAt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

export function CloudDevices() {
  const cloud = useCloud().data
  const remove = useRemoveMac()
  if (cloud?.status === 'on' || cloud?.status === 'offline') return <>
    {cloud.rotate.length > 0 && <RotateConnections rotate={cloud.rotate} />}
    {cloud.devices.map((device) => <Row key={device.key} icon={<DeviceIcon kind={device.kind} />} title={device.name ?? (device.kind === 'server' ? 'Computer that runs agents' : 'Computer')} note={[device.here && (isPhone() ? 'Your computer' : 'This computer'), device.addedAt && `Added ${addedAt.format(new Date(device.addedAt))}`].filter(Boolean).join(' · ')}>
      {!device.here && !isPhone() && !cloud.youngUntil && <ConfirmButton className={PILL} disabled={remove.isPending} question={`Remove ${device.name ?? 'this device'}?`} detail={device.addedAt ? `Added ${shortDateTime.format(new Date(device.addedAt))}. ${REMOVE_DETAIL}` : REMOVE_DETAIL} action="Remove" onConfirm={() => remove.mutate(device.key)}>Remove</ConfirmButton>}
    </Row>)}
    {cloud.youngUntil && <p className="m-0 px-1 text-[12.5px] text-mute">This computer was added less than 3 days ago. Remove devices from an older one, or after {shortDate.format(new Date(cloud.youngUntil))}.</p>}
    <Row onClick={() => open('add-mac')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-blue" />} title="Unlock a new computer" note={`Let a new computer in with this ${isPhone() ? 'phone' : 'one'}.`}><Chevron /></Row>
  </>
  if (cloud?.status !== 'off' || isPhone()) return null
  return <Row icon={<I icon={SquareLock02Icon} size={20} className="text-mute" />} title="Chat from your other computers" note="Needs OpenHut Cloud"><EnableCloud /></Row>
}

function backupNote({ state, done, total, at, problem, offline }: Backup & { offline: boolean }): string {
  if (problem) return problem
  if (state === 'backing_up') return `Backing up · ${done} of ${total}`
  if (state === 'restoring') return total ? `Restoring your agents · ${Math.min(done + 1, total)} of ${total}` : 'Restoring your agents…'
  if (state === 'failed') return `Couldn’t back up ${total - done} of ${total} · Trying again`
  if (offline) return at ? `Last backup ${ago(at)} ago` : 'Agents, chats and settings · End-to-end encrypted'
  return at ? `Up to date · ${ago(at)} ago` : 'Agents, chats and settings · End-to-end encrypted'
}

function kitNote(kit: Cloud['kit']): string {
  if (kit?.differs) return 'Out of date. Make a new one.'
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
  const send = (code: string) => void confirm('Add the new computer').then((ok) => { if (ok) allow.mutate(code, { onSuccess: ({ devices }) => { markSeen(devices); setAdded(true) } }) })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    send(String(new FormData(event.currentTarget).get('code') ?? ''))
  }
  return <Dialog size="narrow" label="Unlock a new computer" onClose={close}>
    <DialogHead title="Unlock a new computer" onClose={close} />
    <form id="add-mac" onSubmit={submit} className="flex flex-col gap-4 px-5 py-5 text-[13px]/[18px]">
      {added ? <p className="m-0 text-body">Added. Your new computer is unlocking and gets your agents, chats and settings.</p> : <>
        <p className="m-0 text-body">On the new computer, choose Use your iPhone or another computer. Then {isPhone() ? 'scan the code it shows, or type it' : 'type the code it shows'}.</p>
        {isPhone() && <Button type="button" variant="primary" className="h-12 justify-center rounded-xl" disabled={asking || allow.isPending} onClick={() => void scan().then((text) => { if (text) send(text) }, toastError)}>Scan the code</Button>}
        <Input name="code" aria-label="Code" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-X" autoFocus={!isPhone()} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono phone:h-11" />
        <div className="flex gap-2.5 rounded-lg bg-[oklch(97%_0.03_60)] px-3.5 py-3 text-[oklch(40%_0.1_50)]"><I icon={SquareLock02Icon} size={16} className="mt-px shrink-0" /><span>Add only a computer in front of you that’s yours. If someone asked you to do this, on a call, by email or in chat, it’s a scam.</span></div>
        <ErrorNote message={allow.error?.message} />
      </>}
    </form>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={close}>{added ? 'Done' : 'Cancel'}</Button>}>{!added && <Button type="submit" form="add-mac" variant="primary" disabled={asking || allow.isPending}>{allow.isPending ? 'Adding…' : 'Add the new computer'}</Button>}</DialogFoot>
  </Dialog>
}
