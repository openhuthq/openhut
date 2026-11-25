import { type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCreateTeam } from '@/features/cloud/workspaces'
import { navigate, open } from '@/lib/router'

/** Create a team: its own Cloud computer and credits start next, then People opens so you can invite. */
export function CreateTeamDialog() {
  const create = useCreateTeam()
  const close = () => open()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (name) create.mutate(name, { onSuccess: () => navigate('/settings/people') })
  }
  return <Dialog size="narrow" label="Create a team" onClose={close}>
    <DialogHead title="Create a team" subtitle="Your agents in this team are private until you share them." onClose={close} />
    <form id="create-team" onSubmit={submit} className="flex flex-col gap-3 px-5 py-5 text-[13px]/[18px]">
      <Input name="name" aria-label="Team name" placeholder="Team name" required maxLength={60} autoFocus autoComplete="off" />
    </form>
    <DialogFoot error={create.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="submit" form="create-team" variant="primary" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create team'}</Button></DialogFoot>
  </Dialog>
}
