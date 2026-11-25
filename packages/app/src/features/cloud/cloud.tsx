import { Delete02Icon, Key01Icon, Logout03Icon, Mail01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { REMOTE } from '@/lib/remote'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section, Status } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { ConfirmButton } from '@/components/confirm-button'
import { nameOf, useSignOut } from '@/features/cloud/api'
import { Google } from '@/features/cloud/sign-in'
import { config } from '@/lib/config'
import { Chevron, Row, Rows } from '@/features/settings/kit'
import { navigate, useSearch } from '@/lib/router'
import { useDeleteData, useGate, useRotated } from '@/features/cloud/workspaces'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function YouSettings() {
  const { cloud } = useGate()
  const error = new URLSearchParams(useSearch()).get('error') ?? undefined
  const email = cloud.email ?? ''
  return <Section title="You">
    <Rows>
      <Row icon={<PersonFace name={nameOf(email)} email={email} size={20} />} title={nameOf(email)} note={email}>
        {cloud.status === 'offline' && <Status tone="wait">Offline</Status>}
        <SignOut />
      </Row>
    </Rows>
    <ErrorNote message={error} />
  </Section>
}

export function SignInWays() {
  const email = useGate().cloud.email ?? ''
  return <Section title="Ways you can sign in">
    <Rows>
      {config.emailCode && <Row icon={<I icon={Mail01Icon} size={20} className="text-mute" />} title="Email code" note={`Sign in with a code sent to ${email}`}>
        <span className="inline-flex items-center gap-1 text-[12px] text-mute"><I icon={Tick02Icon} size={12} />On</span>
      </Row>}
      <Row icon={<Google size={20} />} title="Google" note={`Connected as ${email}`} />
    </Rows>
  </Section>
}

export function DeleteAccountRow() {
  return <DeleteAccount cloud={useGate().cloud} />
}

export const SIGN_OUT_DETAIL = REMOTE ? 'This browser forgets your account. Your agents and chats stay on your computer.' : 'Your agents, chats and connections are deleted from this computer. They’re backed up, and come back when you sign in again.'

function SignOut() {
  const signOut = useSignOut()
  return <ConfirmButton variant="ghost" className={`${PILL} gap-1.5`} disabled={signOut.isPending} question="Sign out?" detail={SIGN_OUT_DETAIL} action="Sign out" onConfirm={() => signOut.mutateAsync()}><I icon={Logout03Icon} size={13} />{signOut.isPending ? 'Signing out…' : 'Sign out'}</ConfirmButton>
}

function DeleteAccount({ cloud }: { cloud: Cloud }) {
  const remove = useDeleteData()
  const gone = ['Your team, its agents, chats and settings in OpenHut Cloud, for everyone in it', 'Your sign-in', 'Your place in other people’s teams']
  return <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete account" note={DELETE_NOTE}>
    <ConfirmButton variant="secondary" className={cn(PILL, 'text-fail')} disabled={remove.isPending} question="Delete your account?" detail="Agents already on your computers keep running until you remove them. You can’t undo this." list={gone} action="Delete account" typed="delete my account" onConfirm={() => remove.mutateAsync().then(accountDeleted)}>{remove.isPending ? 'Deleting…' : 'Delete account'}</ConfirmButton>
  </Row>
}

const DELETE_NOTE = 'Deletes your account and your team. Agents already on your computers keep running until you remove them.'

function accountDeleted() {
  toast('Account deleted')
}

function RotateConnections({ rotate }: { rotate: Cloud['rotate'] }) {
  const done = useRotated()
  return <Section title="Keys to replace" action={<Button type="button" variant="ghost" className={PILL} disabled={done.isPending} onClick={() => done.mutate(undefined, { onError: toastError })}>Done</Button>}>
    <Rows>{rotate.map((each) => <Row key={each.id} icon={<I icon={Key01Icon} size={18} className="text-hue-amber" />} title={each.name} note={`The device you removed could read this ${each.kind} key. Make a new one at the service.`} onClick={() => navigate('/connections')}><Chevron /></Row>)}</Rows>
  </Section>
}

export function KeysToReplace() {
  const { cloud } = useGate()
  return cloud.rotate.length ? <RotateConnections rotate={cloud.rotate} /> : null
}
