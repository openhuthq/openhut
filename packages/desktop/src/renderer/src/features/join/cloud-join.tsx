import { useEffect, useSyncExternalStore, type FormEvent } from 'react'
import { Link01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { I, PILL } from '@/components/kit'
import { Row, Rows } from '@/features/settings/kit'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Hut } from '@/components/hut'
import { RequestError } from '@/lib/api-client'
import { nameOf, useCloud, useSignIn } from '@/features/cloud/api'
import { Window } from '@/features/cloud/unlock'
import { chooseWorkspace, useInvitePreview, useJoin, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { isPhone } from '@/lib/native'
import { HERE } from '@/features/settings/desktop'

const LINK = 'https://openhut.dev/join'

function useHash() {
  return useSyncExternalStore((listener) => {
    addEventListener('hashchange', listener)
    return () => removeEventListener('hashchange', listener)
  }, () => location.hash)
}

export function CloudJoin() {
  const hash = useHash()
  const link = `${LINK}${hash}`
  const cloud = useCloud().data
  const signIn = useSignIn()
  const { all } = useWorkspaces()
  const on = cloud?.status === 'on' || cloud?.status === 'offline'
  const joined = all.find((each) => each.id === hash.slice(1).split('.')[0])
  const preview = useInvitePreview({ link, enabled: on && !joined })
  const join = useJoin()
  useEffect(() => {
    if (!joined) return
    chooseWorkspace(joined.id)
    navigate('/', true)
  }, [joined])
  if (!cloud || joined) return null
  if (!on) return <Window>
    <Hut mood="party" className="size-[84px]" />
    <h1 className="m-0 text-[22px]/[1.25] font-semibold tracking-[-.01em]">Join your team</h1>
    <p className="m-0 max-w-[420px] text-[14px] text-body">{isPhone() ? `Enable OpenHut Cloud on your ${HERE} with the email the invite was sent to, then open the link again.` : 'Sign in with the email the invite was sent to.'}</p>
    {!isPhone() && <Button type="button" variant="primary" className="mt-2 h-10 w-[300px] justify-center phone:h-12 phone:w-full gap-2" disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}><Google />Continue with Google</Button>}
  </Window>
  const error = preview.error ?? join.error
  if (error) {
    const { title, body } = refusal({ error, email: cloud.email })
    return <Window>
      <Hut mood="worried" className="size-[84px]" />
      <h1 className="m-0 text-[22px]/[1.25] font-semibold tracking-[-.01em]">{title}</h1>
      <p className="m-0 max-w-[420px] text-[14px] text-body">{body}</p>
      <Button type="button" variant="secondary" className="mt-2 h-10 w-[300px] justify-center phone:h-12 phone:w-full" onClick={() => navigate('/', true)}>Back to OpenHut</Button>
    </Window>
  }
  const invite = preview.data
  if (!invite) return <Window><Hut mood="looking" className="size-[84px]" /><p className="m-0 text-[14px] text-body">Opening your invite…</p></Window>
  const done = () => {
    chooseWorkspace(invite.workspace)
    navigate('/', true)
  }
  return <Window>
    <Hut mood="party" className="size-[84px]" />
    <h1 className="m-0 text-[22px]/[1.25] font-semibold tracking-[-.01em]">Join {invite.name}</h1>
    <p className="m-0 max-w-[420px] text-[14px] text-body">{nameOf(invite.from)} invited you as {invite.role === 'admin' ? 'an admin' : 'a member'}.</p>
    <Button type="button" variant="primary" className="mt-2 h-10 w-[300px] justify-center phone:h-12 phone:w-full" disabled={join.isPending} onClick={() => join.mutate(link, { onSuccess: done })}>{join.isPending ? 'Joining…' : 'Join workspace'}</Button>
    <span className="inline-flex items-center gap-1.5 text-[12px] text-mute"><Google />Signed in as {cloud.email}</span>
  </Window>
}

function refusal({ error, email }: { error: Error; email: string | null }): { title: string; body: string } {
  const status = error instanceof RequestError ? error.status : 0
  if (status === 403) return { title: 'This invite is for another email', body: `It’s for ${error instanceof RequestError && error.param ? error.param : 'another email'}. You’re signed in as ${email ?? 'someone else'}.` }
  if (status === 404 || status === 410) return { title: 'This invite link no longer works', body: 'It was used already or it expired. Ask for a new one.' }
  return { title: 'This invite didn’t open', body: error.message }
}

export function JoinRow() {
  return <Rows>
    <Row icon={<I icon={Link01Icon} size={20} className="text-hue-blue" />} title="Join a team" note="Got an invite link? Paste it here.">
      <Button type="button" variant="secondary" className={PILL} onClick={() => open('join-link')}>Join with a link</Button>
    </Row>
  </Rows>
}

export function JoinLinkDialog() {
  const close = () => open()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = String(new FormData(event.currentTarget).get('link') ?? '').trim()
    const hash = text.slice(text.indexOf('#'))
    if (text.includes('#')) navigate(`/join${hash}`)
  }
  return <Dialog size="narrow" label="Join with a link" onClose={close}>
    <DialogHead title="Join with a link" onClose={close} />
    <form id="join-link" onSubmit={submit} className="flex flex-col gap-3 px-5 py-5 text-[13px]/[18px]">
      <p className="m-0 text-body">Paste the invite link someone sent you.</p>
      <Input name="link" aria-label="Invite link" placeholder={`${LINK}#…`} autoFocus autoComplete="off" spellCheck={false} />
    </form>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="submit" form="join-link" variant="primary">Open invite</Button></DialogFoot>
  </Dialog>
}

function Google() {
  return <svg width={13} height={13} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
