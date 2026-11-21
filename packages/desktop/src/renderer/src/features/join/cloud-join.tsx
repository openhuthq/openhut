import { useSyncExternalStore, type FormEvent } from 'react'
import { AiMagicIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Hut } from '@/components/hut'
import { I } from '@/components/kit'
import { RequestError } from '@/lib/api-client'
import { nameOf, useCloud, useSignIn } from '@/features/cloud/api'
import { Window } from '@/features/cloud/unlock'
import { chooseWorkspace, useInvitePreview, useJoin } from '@/features/cloud/workspaces'
import { HERE } from '@/features/settings/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { navigate, open } from '@/lib/router'
import { toastError } from '@/lib/toast'

const LINK = 'https://openhut.dev/join'

function useHash() {
  return useSyncExternalStore((listener) => {
    addEventListener('hashchange', listener)
    return () => removeEventListener('hashchange', listener)
  }, () => location.hash)
}

export function CloudJoin() {
  const link = `${LINK}${useHash()}`
  const cloud = useCloud().data
  const signIn = useSignIn()
  const on = cloud?.status === 'on' || cloud?.status === 'offline'
  const preview = useInvitePreview(link, on)
  const join = useJoin()
  const back = <Button type="button" variant="secondary" className="mt-2 h-10 w-[300px] justify-center" onClick={() => navigate('/', true)}>Back to OpenHut</Button>
  if (!cloud) return null
  if (!on) return <Window>
    <Hut mood="party" className="size-[84px]" />
    <h1 className="m-0 text-[22px]/[1.25] font-semibold tracking-[-.01em]">Join your team</h1>
    <p className="m-0 max-w-[420px] text-[14px] text-body">Sign in with the email the invite was sent to. The workspace key comes sealed, and only this {HERE} can open it.</p>
    <Button type="button" variant="primary" className="mt-2 h-10 w-[300px] justify-center gap-2" disabled={signIn.isPending} onClick={() => signIn.mutate(undefined, { onError: toastError })}><Google />Continue with Google</Button>
  </Window>
  const error = preview.error ?? join.error
  if (error) {
    const wrong = error instanceof RequestError && error.status === 403
    return <Window>
      <Hut mood="worried" className="size-[84px]" />
      <h1 className="m-0 text-[22px]/[1.25] font-semibold tracking-[-.01em]">{wrong ? 'This invite is for another email' : error instanceof RequestError && [404, 410].includes(error.status) ? 'This invite link no longer works' : 'This invite didn’t open'}</h1>
      <p className="m-0 max-w-[420px] text-[14px] text-body">{error.message}</p>
      {back}
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
    <div className="mt-1 w-[300px] rounded-lg border border-hair bg-card p-1.5 text-left"><Rows><Row icon={<I icon={AiMagicIcon} size={20} className="text-hue-violet" />} title="Shared agents" note="Ready once you join" /></Rows></div>
    <Button type="button" variant="primary" className="mt-2 h-10 w-[300px] justify-center" disabled={join.isPending} onClick={() => join.mutate(link, { onSuccess: done })}>{join.isPending ? 'Joining…' : 'Join workspace'}</Button>
    <span className="inline-flex items-center gap-1.5 text-[12px] text-mute"><Google />Signed in as {cloud.email}</span>
  </Window>
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
