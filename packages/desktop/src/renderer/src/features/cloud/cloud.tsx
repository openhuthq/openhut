import { CloudUploadIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import type { Backup } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Status } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { ConfirmButton } from '@/components/confirm-button'
import { nameOf, useCloud, useForget, useSignIn, useSignOut } from '@/features/cloud/api'
import { CloudOff, NeedsCloud, SaveKit, TurnOn } from '@/features/cloud/sign-in'
import { HERE } from '@/features/settings/desktop'
import { Row } from '@/features/settings/kit'
import { ago, shortDate } from '@/lib/format'
import { open, useOpen, useSearch } from '@/lib/router'
import { toastError } from '@/lib/toast'

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export function CloudSettings() {
  const cloud = useCloud()
  const signOut = useSignOut()
  const forget = useForget()
  const kitOpen = useOpen() === 'kit'
  const error = new URLSearchParams(useSearch()).get('error') ?? cloud.error?.message
  const data = cloud.data
  if (!data) return <ErrorNote message={error} />
  if (data.status === 'off') return <>
    <CloudOff />
    <ErrorNote message={error ?? data.signInError ?? undefined} />
    {data.keptAccount && <div className="flex items-center gap-4 px-1">
      <span className="grid flex-1 gap-0.5"><span className="text-[13.5px] font-semibold">{data.keptAccount}</span><span className="text-[12.5px] text-body">Its keys stay on this {HERE} after sign-out.</span></span>
      <ConfirmButton variant="secondary" className={PILL} disabled={forget.isPending} question={`Forget ${data.keptAccount} on this ${HERE}?`} detail={`This removes its keys from this ${HERE} only. Its backup stays in OpenHut Cloud, and your recovery words still restore it here or on another ${HERE}.`} action="Forget" onConfirm={() => forget.mutate(undefined, { onError: toastError })}>Forget on this {HERE}</ConfirmButton>
    </div>}
  </>
  const email = data.email ?? ''
  return <>
    <div className="flex items-center gap-3.5 px-1">
      <PersonFace name={nameOf(email)} email={email} size={48} />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[18px]/[1.2] font-semibold tracking-[-.01em]">{nameOf(email)}</span>{data.status === 'on' ? <span className="flex items-center gap-1.5 text-[12px] text-mute"><Google />{email}</span> : <span className="text-[12px] text-mute">Can't reach OpenHut Cloud. Your agents keep working.</span>}</span>
      {data.status === 'on' ? <Status tone="on">On</Status> : <Status tone="wait">Offline</Status>}
    </div>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      <div className="flex items-center gap-3 px-4 py-3"><I icon={CloudUploadIcon} size={18} className="text-hue-blue" /><span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Backup</span><span className="text-[12px] text-mute">{backupNote(data.backup)}</span></span></div>
      <div className="flex items-center gap-3 px-4 py-3"><I icon={SquareLock02Icon} size={18} className="text-hue-amber" /><span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Only your devices can read it</span><span className="text-[12px] text-mute">{data.kit ? `Recovery kit saved ${shortDate.format(new Date(data.kit.savedAt))}` : 'No recovery kit'}{data.keyStore === 'file' && ' · Keys in a file only you can read'}</span></span><Button type="button" variant="secondary" className={PILL} onClick={() => open('kit')}>{data.kit ? 'Make a new kit' : 'Save a kit'}</Button></div>
    </div>
    <div className="flex items-center gap-4 px-1">
      <span className="grid flex-1 gap-0.5"><span className="text-[13.5px] font-semibold">Sign out</span><span className="text-[12.5px] text-body">Your agents keep running on this {HERE}.</span></span>
      <Button type="button" variant="secondary" className={PILL} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out</Button>
    </div>
    <ErrorNote message={error ?? undefined} />
    {kitOpen && <SaveKit />}
  </>
}

export function PeopleSettings() {
  const cloud = useCloud().data
  if (!cloud) return null
  if (cloud.status === 'off' || !cloud.workspace) return <NeedsCloud title="Work on agents with your team" />
  const members = cloud.workspace.members
  return <section className="flex flex-col gap-2.5">
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      {members.map((member) => <div key={member.email} className="flex items-center gap-3 px-4 py-3">
        <PersonFace name={nameOf(member.email)} email={member.email} size={40} />
        <span className="grid min-w-0 flex-1 gap-px"><span className="flex items-center gap-2 text-[13.5px] font-medium">{nameOf(member.email)}{member.email === cloud.email && <span className="text-[12px] font-normal text-mute">You</span>}</span><span className="truncate text-[12px] text-mute">{member.email}</span></span>
        <span className="text-[13px] text-body">{ROLE[member.role]}</span>
      </div>)}
    </div>
  </section>
}

export function CloudDevices() {
  const cloud = useCloud().data
  const signIn = useSignIn()
  if (cloud?.status !== 'off') return null
  return <Row icon={<I icon={SquareLock02Icon} size={20} className="text-mute" />} title="Chat from your other computers" note="Needs OpenHut Cloud"><TurnOn short pending={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })} /></Row>
}

function backupNote({ state, done, total, at }: Backup): string {
  if (state === 'backing_up') return `Backing up · ${done} of ${total}`
  if (state === 'restoring') return 'Restoring…'
  return at ? `Up to date · ${ago(at)} ago` : `Agents and settings, locked on this ${HERE} first`
}

function Google() {
  return <svg width={12} height={12} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
