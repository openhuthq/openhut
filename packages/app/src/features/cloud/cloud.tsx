import { Delete02Icon, FingerPrintIcon, Key01Icon, LifebuoyIcon, Logout03Icon } from '@hugeicons/core-free-icons'
import type { Cloud, CloudWorkspaceView, DeviceRequest } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section, Status } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { DeviceIcon, DeviceMeta } from '@/components/custom/device'
import { notify } from '@/components/custom/toast'
import { ConfirmButton } from '@/components/confirm-button'
import { nameOf, REMOVE_DETAIL, REMOVE_POINTS, useAddPasskey, usePasskeys, useRemoveMac, useRemovePasskey, useSignOut } from '@/features/cloud/api'
import { SaveKit } from '@/features/cloud/sign-in'
import { Guide } from '@/features/cloud/step'
import { Chevron, Row, Rows } from '@/features/settings/kit'
import { isPhone, useConfirmed } from '@/lib/native'
import { ago, shortDate, shortDateTime } from '@/lib/format'
import { navigate, open, useOpen, useSearch } from '@/lib/router'
import { useApprove, useDeleteData, useDeny, useGate, useRotated } from '@/features/cloud/workspaces'
import { toast, toastError } from '@/lib/toast'
import { useAnswer } from '@/features/cloud/review'
import { cn } from '@/lib/utils'

export function YouSettings() {
  const { cloud } = useGate()
  const opened = useOpen()
  const helper = usePasskeys()
  const addPasskey = useAddPasskey()
  const removePasskey = useRemovePasskey()
  const error = new URLSearchParams(useSearch()).get('error') ?? undefined
  const email = cloud.email ?? ''
  const young = Boolean(cloud.youngUntil)
  return <Section title="You">
    <Rows>
      <Row icon={<PersonFace name={nameOf(email)} email={email} size={20} />} title={nameOf(email)} note={<span className="flex items-center gap-1.5"><Google />{email}</span>}>
        {cloud.status === 'offline' && <Status tone="wait">Offline</Status>}
        <SignOut />
      </Row>
      <Row icon={<I icon={LifebuoyIcon} size={20} className="text-hue-amber" />} title="Recovery kit" note={<span className={cloud.kit?.differs ? 'text-fail' : undefined}>Your 12 words to get back in if you lose every computer. {kitNote(cloud.kit)}.</span>}>
        {!young && <Button type="button" variant="secondary" className={PILL} onClick={() => open('kit')}>New kit</Button>}
      </Row>
      {helper?.passkeys && helper.prf && <Row icon={<I icon={FingerPrintIcon} size={20} className="text-hue-green" />} title="Touch ID" note={cloud.passkey ? 'On · in iCloud Keychain. Your Macs on this Apple Account open OpenHut with one touch.' : 'Unlock OpenHut on your next Mac with your fingerprint'}>
        {cloud.passkey
          ? <ConfirmButton variant="ghost" className={PILL} disabled={removePasskey.isPending} question="Turn Touch ID off?" detail="Your Macs stop opening OpenHut with Touch ID. Your recovery kit still works, and you can turn it on again here." action="Turn off" onConfirm={() => removePasskey.mutateAsync()}>Remove</ConfirmButton>
          : !young && <Button type="button" variant="ghost" className={PILL} disabled={addPasskey.isPending} onClick={() => addPasskey.mutate(email, { onError: toastError })}>Add</Button>}
      </Row>}
    </Rows>
    <ErrorNote message={error} />
    {opened === 'kit' && <KitDialog />}
  </Section>
}

export function DeleteAccountRow() {
  return <DeleteAccount cloud={useGate().cloud} />
}

function KitDialog() {
  return <Guide label="Recovery kit" at={0} of={1} onClose={() => open()}>
    <SaveKit onDone={() => open()} />
  </Guide>
}

function SignOut() {
  const signOut = useSignOut()
  return <ConfirmButton variant="ghost" className={`${PILL} gap-1.5`} disabled={signOut.isPending} question="Sign out?" detail="Your agents, chats and connections are deleted from this computer. They’re backed up, and come back when you sign in again." action="Sign out" onConfirm={() => signOut.mutateAsync()}><I icon={Logout03Icon} size={13} />{signOut.isPending ? 'Signing out…' : 'Sign out'}</ConfirmButton>
}

function DeleteAccount({ cloud }: { cloud: Cloud }) {
  const remove = useDeleteData()
  const gone = ['Your team, its agents, chats and settings in OpenHut Cloud, for everyone in it', cloud.passkey ? 'Your recovery kit, Touch ID and sign-in' : 'Your recovery kit and sign-in', 'Your place in other people’s teams']
  return <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete account" note={cloud.youngUntil ? `This computer was added less than 3 days ago. Delete your account from an older one, or after ${shortDate.format(new Date(cloud.youngUntil))}.` : DELETE_NOTE}>
    <ConfirmButton variant="secondary" className={cn(PILL, 'text-fail')} disabled={Boolean(cloud.youngUntil) || remove.isPending} question="Delete your account?" detail="Agents already on your computers keep running until you remove them. You can’t undo this." list={gone} action="Delete account" typed="delete my account" onConfirm={() => remove.mutateAsync().then(accountDeleted)}>{remove.isPending ? 'Deleting…' : 'Delete account'}</ConfirmButton>
  </Row>
}

const DELETE_NOTE = 'Deletes your account and your team. Agents already on your computers keep running until you remove them.'

function accountDeleted() {
  notify({ title: 'Account deleted', note: 'Your agents and chats stay on this computer.' })
}

function RotateConnections({ rotate }: { rotate: Cloud['rotate'] }) {
  const done = useRotated()
  return <Section title="Keys to replace" action={<Button type="button" variant="ghost" className={PILL} disabled={done.isPending} onClick={() => done.mutate(undefined, { onError: toastError })}>Done</Button>}>
    <Rows>{rotate.map((each) => <Row key={each.id} icon={<I icon={Key01Icon} size={18} className="text-hue-amber" />} title={each.name} note={`The device you removed could read this ${each.kind} key. Make a new one at the service.`} onClick={() => navigate('/connections')}><Chevron /></Row>)}</Rows>
  </Section>
}

const addedAt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

export type CloudDevice = Cloud['devices'][number]

export function deviceNote({ device, note }: { device: CloudDevice | undefined; note?: string }): string {
  return [device?.here && (isPhone() ? 'Your computer' : 'This computer'), note, device?.addedAt && `Added ${addedAt.format(new Date(device.addedAt))}`].filter(Boolean).join(' · ')
}

export function KeysToReplace() {
  const { cloud } = useGate()
  return cloud.rotate.length ? <RotateConnections rotate={cloud.rotate} /> : null
}

export function CloudDevices({ merged }: { merged: string[] }) {
  const { cloud } = useGate()
  const remove = useRemoveMac()
  const home = cloud.workspaces.find((workspace) => workspace.home && workspace.own)
  return <>
    {home?.requests.filter((each) => each.email === cloud.email).map((each) => <JoinRequestRow key={each.device} workspace={home} request={each} />)}
    {cloud.devices.filter((device) => !merged.includes(device.key)).map((device) => <Row key={device.key} icon={<DeviceIcon kind={device.kind} />} title={device.name ?? (device.kind === 'server' ? 'Computer that runs agents' : 'Computer')} note={deviceNote({ device })}>
      {!device.here && !isPhone() && !cloud.youngUntil && <ConfirmButton variant="secondary" className={cn(PILL, 'text-fail')} disabled={remove.isPending} question={`Remove ${device.name ?? 'this device'}?`} detail={device.addedAt ? `Added ${shortDateTime.format(new Date(device.addedAt))} · ${REMOVE_DETAIL}` : REMOVE_DETAIL} points={REMOVE_POINTS} action="Remove" onConfirm={() => remove.mutate({ key: device.key })}>Remove</ConfirmButton>}
    </Row>)}
    {cloud.youngUntil && <p className="m-0 px-1 text-[12.5px] text-mute">This computer was added less than 3 days ago. Remove devices from an older one, or after {shortDate.format(new Date(cloud.youngUntil))}.</p>}
  </>
}

export function JoinRequestRow({ workspace, request }: { workspace: CloudWorkspaceView; request: DeviceRequest }) {
  const title = request.name ?? 'New computer'
  const answer = useAnswer({ workspace: workspace.id, request, label: title })
  const kind = request.server ? 'server' : 'mac'
  return <Row icon={<DeviceIcon kind={kind} />} title={title} note={<>Wants to join · <DeviceMeta device={{ kind, name: title, os: request.os ?? undefined, when: `${ago(request.at)} ago` }} /></>}>
    <Button type="button" variant="ghost" className={PILL} disabled={answer.busy} onClick={answer.notMe}>Not mine</Button>
    <Button type="button" variant="primary" className={PILL} disabled={answer.busy} onClick={answer.approve}>{request.checked ? 'Review' : 'Approve'}</Button>
    {answer.dialog}
  </Row>
}

function kitNote(kit: Cloud['kit']): string {
  if (kit?.differs) return 'Yours is out of date. Make a new one'
  return kit ? `Saved ${shortDate.format(new Date(kit.savedAt))}` : 'Not saved'
}

function Google() {
  return <svg width={12} height={12} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}

