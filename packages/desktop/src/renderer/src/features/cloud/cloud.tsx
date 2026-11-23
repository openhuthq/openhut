import { Delete02Icon, FingerPrintIcon, Key01Icon, Logout03Icon } from '@hugeicons/core-free-icons'
import type { Cloud, CloudWorkspaceView, DeviceRequest } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section, Status } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { DeviceIcon, DeviceMeta } from '@/components/custom/device'
import { notify } from '@/components/custom/toast'
import { ConfirmButton } from '@/components/confirm-button'
import { nameOf, REMOVE_DETAIL, useAddPasskey, usePasskeys, useRemoveMac, useSignOut } from '@/features/cloud/api'
import { SaveKit } from '@/features/cloud/sign-in'
import { Guide } from '@/features/cloud/step'
import { Chevron, Row, Rows } from '@/features/settings/kit'
import { isPhone, useConfirmed } from '@/lib/native'
import { ago, shortDate, shortDateTime } from '@/lib/format'
import { navigate, open, useOpen, useSearch } from '@/lib/router'
import { useApprove, useDeleteData, useDeny, useGate, useRotated } from '@/features/cloud/workspaces'
import { toast, toastError } from '@/lib/toast'

export function AccountSettings() {
  const { cloud } = useGate()
  const opened = useOpen()
  const helper = usePasskeys()
  const addPasskey = useAddPasskey()
  const error = new URLSearchParams(useSearch()).get('error') ?? undefined
  const email = cloud.email ?? ''
  const young = Boolean(cloud.youngUntil)
  return <>
    <div className="flex items-center gap-3.5 px-1">
      <PersonFace name={nameOf(email)} email={email} size={48} />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[18px]/[1.2] font-semibold tracking-[-.01em]">{nameOf(email)}</span><span className="flex items-center gap-1.5 text-[12px] text-mute"><Google />{email}</span></span>
      {cloud.status === 'offline' && <Status tone="wait">Offline</Status>}
      <SignOut />
    </div>
    <Rows>
      <Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Recovery kit" note={<span className={cloud.kit?.differs ? 'text-fail' : undefined}>{kitNote(cloud.kit)}{cloud.keyStore === 'file' && ' · Stored in a file, not the keychain'}</span>}>
        {!young && <Button type="button" variant="ghost" className={PILL} onClick={() => open('kit')}>New kit</Button>}
      </Row>
      {helper?.passkeys && helper.prf && <Row icon={<I icon={FingerPrintIcon} size={20} className="text-hue-green" />} title="Touch ID" note={cloud.passkey ? 'On' : 'Unlock a new Mac with your fingerprint'}>
        {!cloud.passkey && !young && <Button type="button" variant="ghost" className={PILL} disabled={addPasskey.isPending} onClick={() => addPasskey.mutate(email, { onError: toastError })}>Add</Button>}
      </Row>}
      <DeleteAccount cloud={cloud} />
    </Rows>
    <ErrorNote message={error} />
    {opened === 'kit' && <KitDialog />}
  </>
}

function KitDialog() {
  return <Guide label="Recovery kit" at={0} of={1} onClose={() => open()}>
    <SaveKit onDone={() => open()} />
  </Guide>
}

function SignOut() {
  const signOut = useSignOut()
  return <ConfirmButton variant="secondary" disabled={signOut.isPending} question="Sign out?" detail="Your agents, chats and connections are deleted from this computer. They’re backed up, and come back when you sign in again." action="Sign out" onConfirm={() => signOut.mutateAsync()}><I icon={Logout03Icon} size={16} />{signOut.isPending ? 'Signing out…' : 'Sign out'}</ConfirmButton>
}

function DeleteAccount({ cloud }: { cloud: Cloud }) {
  const remove = useDeleteData()
  const gone = ['Your team, its agents, chats and settings in OpenHut Cloud, for everyone in it', cloud.passkey ? 'Your recovery kit, Touch ID and sign-in' : 'Your recovery kit and sign-in', 'Your place in other people’s teams']
  return <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete account" note={cloud.youngUntil ? `This computer was added less than 3 days ago. Delete your account from an older one, or after ${shortDate.format(new Date(cloud.youngUntil))}.` : DELETE_NOTE}>
    <ConfirmButton className={PILL} disabled={Boolean(cloud.youngUntil) || remove.isPending} question="Delete your account?" detail="Your agents and chats stay on this computer. You can’t undo this." list={gone} action="Delete account" typed="delete my account" onConfirm={() => remove.mutateAsync().then(accountDeleted)}>{remove.isPending ? 'Deleting…' : 'Delete account'}</ConfirmButton>
  </Row>
}

const DELETE_NOTE = 'Deletes your account and your team. Agents on this computer stay.'

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
      {!device.here && !isPhone() && !cloud.youngUntil && <ConfirmButton className={PILL} disabled={remove.isPending} question={`Remove ${device.name ?? 'this device'}?`} detail={device.addedAt ? `Added ${shortDateTime.format(new Date(device.addedAt))}. ${REMOVE_DETAIL}` : REMOVE_DETAIL} action="Remove" onConfirm={() => remove.mutate(device.key)}>Remove</ConfirmButton>}
    </Row>)}
    {cloud.youngUntil && <p className="m-0 px-1 text-[12.5px] text-mute">This computer was added less than 3 days ago. Remove devices from an older one, or after {shortDate.format(new Date(cloud.youngUntil))}.</p>}
  </>
}

export function JoinRequestRow({ workspace, request }: { workspace: CloudWorkspaceView; request: DeviceRequest }) {
  const approve = useApprove()
  const deny = useDeny()
  const { asking, confirm } = useConfirmed()
  const title = request.name ?? 'New computer'
  const busy = approve.isPending || deny.isPending || asking
  return <Row icon={<DeviceIcon kind="mac" />} title={title} note={<>Wants to join · <DeviceMeta device={{ kind: 'mac', name: title, os: request.os ?? undefined, when: `${ago(request.at)} ago` }} /></>}>
    <Button type="button" variant="ghost" className={PILL} disabled={busy} onClick={() => deny.mutate({ id: workspace.id, device: request.device }, { onSuccess: () => toast('Denied'), onError: toastError })}>Deny</Button>
    <Button type="button" variant="primary" className={PILL} disabled={busy} onClick={() => void confirm(`Approve ${title}`).then((ok) => { if (ok) approve.mutate({ id: workspace.id, device: request.device }, { onSuccess: () => toast(`${title} is unlocking`), onError: toastError }) })}>{approve.isPending ? 'Approving…' : 'Approve'}</Button>
  </Row>
}

function kitNote(kit: Cloud['kit']): string {
  if (kit?.differs) return 'Out of date. Make a new one.'
  return kit ? `Saved ${shortDate.format(new Date(kit.savedAt))}` : 'Not saved'
}

function Google() {
  return <svg width={12} height={12} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}

