import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Hut } from '@/components/hut'
import { RequestError } from '@/lib/api-client'
import { useAgents } from '@/features/agents/api'
import { nameOf, useSignOut } from '@/features/cloud/api'
import { Window } from '@/features/cloud/step'
import { chooseWorkspace, useGate, useInvitePreview, useJoin } from '@/features/cloud/workspaces'
import { forgetInvite, INVITE_PAGE, inviteOf, keepInvite } from '@/features/join/invite'
import { navigate, open } from '@/lib/router'

const BIG = 'mt-2 h-10 w-[300px] justify-center phone:h-12 phone:w-full'
const QUIET = 'font-normal text-mute'
const SETTLE_MS = 1500
const AGENTS_WAIT_MS = 30_000
const AGENTS_POLL_MS = 2000

function useHash() {
  return useSyncExternalStore((listener) => {
    addEventListener('hashchange', listener)
    return () => removeEventListener('hashchange', listener)
  }, () => location.hash)
}

export function CloudJoin() {
  const hash = useHash()
  const parsed = inviteOf(hash)
  const link = parsed?.link ?? `${INVITE_PAGE}${hash}`
  const { cloud } = useGate()
  const [entered, setEntered] = useState<{ id: string; name: string; from: string }>()
  const joined = !entered ? cloud.workspaces.find((each) => each.id === parsed?.workspace) : undefined
  const preview = useInvitePreview({ link, enabled: !joined && !entered })
  const join = useJoin()
  const signOut = useSignOut({ stay: true })
  useEffect(() => {
    if (!joined) return
    forgetInvite()
    chooseWorkspace(joined.id)
    navigate('/', true)
  }, [joined])
  if (entered) return <Entered team={entered} />
  if (joined) return null
  const leave = () => {
    forgetInvite()
    navigate('/', true)
  }
  const error = preview.error ?? join.error
  if (error) {
    const status = error instanceof RequestError ? error.status : 0
    const { title, body } = refusal({ error, email: cloud.email })
    const retry = () => {
      join.reset()
      void preview.refetch()
    }
    if (status === 403) return <Card mood="worried" title={title} body={body}
      action={<Button type="button" variant="primary" className={BIG} disabled={signOut.isPending} onClick={() => signOut.mutate()}>{signOut.isPending ? 'Signing out…' : 'Use another Google account'}</Button>}
      link={<Button type="button" variant="text" className={QUIET} onClick={leave}>Not now</Button>} />
    const stranger = parsed?.email && cloud.email && parsed.email.toLowerCase() !== cloud.email.toLowerCase()
    if (status === 404 || status === 410) return <Card mood="worried" title={title} body={body} action={<Button type="button" variant="secondary" className={BIG} onClick={leave}>Back to OpenHut</Button>}
      link={stranger && <Button type="button" variant="text" className={QUIET} disabled={signOut.isPending} onClick={() => signOut.mutate()}>{signOut.isPending ? 'Signing out…' : `Sign out of ${cloud.email}`}</Button>} />
    return <Card mood="worried" title={title} body={body}
      action={<Button type="button" variant="primary" className={BIG} disabled={preview.isFetching} onClick={retry}>{preview.isFetching ? 'Trying…' : 'Try again'}</Button>}
      link={<Button type="button" variant="text" className={QUIET} onClick={() => navigate('/', true)}>Back to OpenHut</Button>} />
  }
  const invite = preview.data
  if (!invite) return <Window><Hut mood="looking" className="size-[84px]" /><p className="m-0 text-[14px] text-body">Opening your invite…</p></Window>
  const accept = () => join.mutate(link, {
    onSuccess: () => {
      forgetInvite()
      chooseWorkspace(invite.workspace)
      setEntered({ id: invite.workspace, name: invite.name, from: invite.from })
    },
  })
  return <Card mood="party" title={`Join ${invite.name}`} body={<><b className="font-medium text-ink">{nameOf(invite.from)} ({invite.from})</b> invited you to <b className="font-medium text-ink">{invite.name}</b> as {invite.role === 'admin' ? 'an admin, who can also invite people and add computers' : 'a member'}. You’ll chat with the agents {invite.name} shares. Agents you make stay private until you share them.</>}
    action={<Button type="button" variant="primary" className={BIG} disabled={join.isPending} onClick={accept}>{join.isPending ? 'Joining…' : 'Join team'}</Button>}
    link={<span className="inline-flex flex-col items-center gap-2"><span className="inline-flex items-center gap-1.5 text-[12px] text-mute"><Google />Signed in as {cloud.email}</span>{!join.isPending && <Button type="button" variant="text" className={QUIET} onClick={leave}>Not now</Button>}</span>} />
}

function Entered({ team }: { team: { id: string; name: string; from: string } }) {
  const agents = useAgents()
  const { cloud } = useGate()
  const [settled, setSettled] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const waiting = cloud.workspaces.find((each) => each.id === team.id)?.waiting
  const arrived = !waiting && (agents.data ?? []).some((agent) => agent.workspace === team.id)
  const { refetch } = agents
  useEffect(() => {
    if (arrived) return
    const poll = setInterval(() => void refetch(), AGENTS_POLL_MS)
    return () => clearInterval(poll)
  }, [arrived, refetch])
  useEffect(() => {
    const settle = setTimeout(() => setSettled(true), SETTLE_MS)
    const give = setTimeout(() => setGaveUp(true), AGENTS_WAIT_MS)
    return () => {
      clearTimeout(settle)
      clearTimeout(give)
    }
  }, [])
  useEffect(() => {
    if (settled && (arrived || gaveUp)) navigate('/', true)
  }, [settled, arrived, gaveUp])
  return <Card mood="party" title={`You’re in ${team.name}.`} body={<span className="inline-flex items-center gap-2"><Spinner className="mt-0" />{waiting ? `Getting the team’s key from ${nameOf(team.from)}’s computer…` : 'Getting the team’s agents…'}</span>} />
}

function Card({ mood, title, body, action, link }: { mood: 'party' | 'worried'; title: string; body: ReactNode; action?: ReactNode; link?: ReactNode }) {
  return <Window>
    <Hut mood={mood} className="size-[84px]" />
    <h1 className="m-0 text-[22px]/[1.25] font-semibold tracking-[-.01em]">{title}</h1>
    <p className="m-0 max-w-[420px] text-[14px] text-body">{body}</p>
    {action}
    {link}
  </Window>
}

function refusal({ error, email }: { error: Error; email: string | null }): { title: string; body: string } {
  const status = error instanceof RequestError ? error.status : 0
  if (status === 403) return { title: 'This invite is for another email', body: `It’s for ${error instanceof RequestError && error.param ? error.param : 'another email'}. You’re signed in as ${email ?? 'someone else'}. Sign in with the email it was sent to.` }
  if (status === 410) return { title: 'This invite link no longer works', body: 'Invites last 2 days, and this one ran out. Ask whoever sent it for a new one.' }
  if (status === 404) return { title: 'This invite link no longer works', body: 'It was used already, or it was taken back. Ask whoever sent it for a new one.' }
  if (status === 0 || status >= 500) return { title: 'This invite didn’t open', body: 'Check your internet and try again. Your invite still works.' }
  return { title: 'This invite didn’t open', body: `${error.message} Your invite is still here.` }
}

export function joinPathOf(text: string): string | undefined {
  const link = text.trim()
  return link.includes('#') && !link.endsWith('#') ? `/join${link.slice(link.indexOf('#'))}` : undefined
}

export function JoinLinkDialog() {
  const close = () => open()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const path = joinPathOf(String(new FormData(event.currentTarget).get('link') ?? ''))
    if (!path) return
    keepInvite(path)
    navigate(path)
  }
  return <Dialog size="narrow" label="Join with a link" onClose={close}>
    <DialogHead title="Join with a link" onClose={close} />
    <form id="join-link" onSubmit={submit} className="flex flex-col gap-3 px-5 py-5 text-[13px]/[18px]">
      <p className="m-0 text-body">Paste the invite link someone sent you.</p>
      <Input name="link" aria-label="Invite link" placeholder={`${INVITE_PAGE}#…`} autoFocus autoComplete="off" spellCheck={false} />
    </form>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="submit" form="join-link" variant="primary">Open invite</Button></DialogFoot>
  </Dialog>
}

function Google() {
  return <svg width={13} height={13} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
