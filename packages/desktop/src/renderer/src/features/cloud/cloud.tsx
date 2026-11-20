import { LaptopIcon, SquareLock02Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Status } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { nameOf, useCloud, useSignIn, useSignOut } from '@/features/cloud/api'
import { CloudOff, NeedsCloud, SaveKit, TurnOn } from '@/features/cloud/sign-in'
import { HERE } from '@/features/settings/desktop'
import { WORDS } from '@/lib/platform'
import { Intro, Row, Rows } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { open, useOpen, useSearch } from '@/lib/router'
import { toastError } from '@/lib/toast'

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export function CloudSettings() {
  const cloud = useCloud()
  const signOut = useSignOut()
  const kitOpen = useOpen() === 'kit'
  const error = new URLSearchParams(useSearch()).get('error') ?? cloud.error?.message
  const data = cloud.data
  if (!data) return <ErrorNote message={error} />
  if (data.status === 'off') return <><CloudOff /><ErrorNote message={error ?? undefined} /></>
  const email = data.email ?? ''
  return <>
    <div className="flex items-center gap-3.5 px-1">
      <PersonFace name={nameOf(email)} size={48} />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[18px]/[1.2] font-semibold tracking-[-.01em]">{nameOf(email)}</span><span className="flex items-center gap-1.5 text-[12px] text-mute"><Google />{email}</span></span>
      {data.status === 'on' ? <Status tone="on">On</Status> : <Status tone="wait">Offline</Status>}
    </div>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      <div className="flex items-center gap-3 px-4 py-3"><I icon={UserGroupIcon} size={18} className="text-hue-blue" /><span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Your workspace</span><span className="text-[12px] text-mute">{data.workspace?.members.length === 1 ? 'Just you' : `${data.workspace?.members.length ?? 0} people`} · nothing syncs yet</span></span></div>
      <div className="flex items-center gap-3 px-4 py-3"><I icon={SquareLock02Icon} size={18} className="text-hue-amber" /><span className="grid flex-1 gap-px"><span className="text-[13.5px] font-medium">Only your devices can read it</span><span className="text-[12px] text-mute">{data.kit ? `Recovery kit saved ${shortDate.format(new Date(data.kit.savedAt))}` : 'No recovery kit'}</span></span><Button type="button" variant="secondary" className={PILL} onClick={() => open('kit')}>{data.kit ? 'Make a new kit' : 'Save a kit'}</Button></div>
    </div>
    <div className="flex items-center gap-4 px-1">
      <span className="grid flex-1 gap-0.5"><span className="text-[13.5px] font-semibold">Sign out</span><span className="text-[12.5px] text-body">Your agents keep running on this {HERE}. People and Devices lock until you sign in again.</span></span>
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
    <div className="flex items-center gap-3 px-1"><span className="ml-auto text-[12px] text-mute">{members.length} {members.length === 1 ? 'person' : 'people'}</span></div>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      {members.map((member) => <div key={member.email} className="flex items-center gap-3 px-4 py-3">
        <PersonFace name={nameOf(member.email)} size={40} />
        <span className="grid min-w-0 flex-1 gap-px"><span className="flex items-center gap-2 text-[13.5px] font-medium">{nameOf(member.email)}{member.email === cloud.email && <span className="text-[12px] font-normal text-mute">You</span>}</span><span className="truncate text-[12px] text-mute">{member.email}</span></span>
        <span className="text-[13px] text-body">{ROLE[member.role]}</span>
      </div>)}
    </div>
  </section>
}

export function CloudDevices() {
  const cloud = useCloud().data
  const signIn = useSignIn()
  if (!cloud) return null
  const store = cloud.keyStore === 'file' ? 'No keyring on this computer, so its keys are in a file only you can read.' : `Its keys are in your ${WORDS.keychain}.`
  return <>
    <Intro>OpenHut Cloud</Intro>
    <Rows>
      {cloud.status === 'off'
        ? <Row icon={<I icon={SquareLock02Icon} size={20} className="text-mute" />} title="Chat from your other computers" note="Needs OpenHut Cloud"><TurnOn short pending={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })} /></Row>
        : <Row icon={<I icon={LaptopIcon} size={20} className="text-hue-green" />} title={WORDS.thisComputer} note={`In your workspace. ${store}`}><span className="text-[12px] text-mute">You're on it now</span></Row>}
    </Rows>
  </>
}

function Google() {
  return <svg width={12} height={12} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
