import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { firstName } from '@/features/cloud/live'
import { BIG, EntryScreen, QUIET } from '@/features/cloud/step'
import type { Invited } from '@/lib/remote'

/** The invitee, signed in: join the team the email invited them to, or not now. */
export function JoinCard({ invited, email, onJoin, onNotNow }: { invited: Invited; email: string; onJoin: () => Promise<unknown>; onNotNow: () => void }) {
  const join = useMutation({ mutationFn: onJoin })
  const team = invited.team ?? 'the team'
  const from = invited.from ? firstName(invited.from) : 'Your teammate'
  return <EntryScreen mood="party" title={`Join ${team}`} line={`${from} invited you to ${team} as ${invited.role === 'admin' ? 'an admin' : 'a member'}. You’ll chat with the agents ${team} shares.`}
    action={<Button type="button" variant="primary" className={BIG} disabled={join.isPending} onClick={() => join.mutate()}>{join.isPending ? 'Joining…' : 'Join team'}</Button>}
    foot={<><Button type="button" variant="text" className={QUIET} disabled={join.isPending} onClick={onNotNow}>Not now</Button><span>Signed in as {email}</span></>}>
    <ErrorNote message={join.error?.message} />
  </EntryScreen>
}
