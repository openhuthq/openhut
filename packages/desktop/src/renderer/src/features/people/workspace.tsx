import { useState, type FormEvent, type ReactNode } from 'react'
import { Delete02Icon, Key01Icon, Logout03Icon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { useChangeKeys, useDeleteWorkspace, useRemoveMember, useRename, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { I, PILL, Section } from '@/components/kit'
import { Row, Rows } from '@/features/settings/kit'
import { cn } from '@/lib/utils'

const KEYS_NOTE = 'Use after a lost computer or a teammate you don’t trust. Everyone else stays in.'

export function WorkspaceSettings() {
  const { active } = useWorkspaces()
  const rename = useRename()
  if (!active) return null
  const { name } = active
  const save = (value: string) => {
    if (value.trim() && value.trim() !== name) rename.mutate({ id: active.id, name: value }, { onSuccess: () => toast('Team renamed') })
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save(String(new FormData(event.currentTarget).get('name') ?? ''))
  }
  return <section className="flex flex-col gap-2">
    <form onSubmit={submit} className="flex items-end gap-3 px-1">
      <label className="grid flex-1 gap-1">
        <span className="text-[12px] text-mute">Team name</span>
        <Input key={name} name="name" defaultValue={name} maxLength={60} disabled={active.role === 'member' || rename.isPending} onBlur={(event) => save(event.currentTarget.value)} className="h-9 text-[13.5px]" />
      </label>
    </form>
    {active.role === 'member' && <p className="m-0 px-1 text-[12px] text-mute">Only an owner or admin can rename it.</p>}
    <ErrorNote message={rename.error?.message} />
  </section>
}

export function TeamDanger({ ownDelete }: { ownDelete: ReactNode }) {
  const { active } = useWorkspaces()
  const opened = useOpen()
  const changeKeys = useChangeKeys()
  const [changing, setChanging] = useState(false)
  if (!active) return <Section title="Danger zone"><Rows>{ownDelete}</Rows></Section>
  const name = active.name
  const owner = active.role === 'owner'
  const admin = active.role !== 'member'
  const changed = () => {
    notify({ title: 'Encryption reset', note: 'Everyone else stays in.' })
    if (active.own) navigate('/settings/team?open=kit')
  }
  return <Section title="Danger zone">
    <Rows>
      {admin && <Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Reset encryption" note={KEYS_NOTE}>
        <Button type="button" variant="secondary" className={cn(PILL, 'text-fail')} disabled={changeKeys.isPending} onClick={() => setChanging(true)}>Reset encryption</Button>
      </Row>}
      {!active.own && <Row icon={<I icon={Logout03Icon} size={20} className="text-fail" />} title={`Leave ${name}`} note={owner ? 'Make someone else the owner first.' : 'For good. What you made stays with the team.'}>
        <Button type="button" variant="secondary" className={cn(PILL, 'text-fail')} disabled={owner} onClick={() => open('leave')}>Leave</Button>
      </Row>}
      {active.own ? ownDelete : admin && <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete team" note="Deletes everything in it for everyone.">
        <Button type="button" variant="secondary" className={cn(PILL, 'text-fail')} onClick={() => open('delete')}>Delete team</Button>
      </Row>}
    </Rows>
    <ConfirmDialog open={changing} onOpenChange={setChanging} question={`Reset encryption for ${name}?`} detail={active.own ? `${KEYS_NOTE} You save a new recovery kit after.` : KEYS_NOTE} action="Change keys" onConfirm={() => changeKeys.mutateAsync(active.id).then(changed)} />
    {opened === 'leave' && !active.own && <LeaveConfirm workspace={active} />}
    {opened === 'delete' && admin && !active.own && <DeleteConfirm workspace={active} />}
  </Section>
}

function LeaveConfirm({ workspace }: { workspace: CloudWorkspaceView }) {
  const name = workspace.name
  const leave = useRemoveMember()
  const { email } = useWorkspaces()
  const close = () => open()
  const go = () => leave.mutate({ id: workspace.id, email: email ?? '' }, { onSuccess: () => { toast(`You left ${name}`); navigate('/') } })
  return <Dialog size="narrow" label={`Leave ${name}?`} onClose={close}>
    <DialogHead title={`Leave ${name}?`} onClose={close} />
    <div className="px-5 py-5 text-[13px]/[18px] text-body">You lose access to its agents, chats and settings. What you made stays with {name}. To come back, ask an admin for a new invite.</div>
    <DialogFoot error={leave.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="button" variant="destructive" disabled={leave.isPending} onClick={go}>{leave.isPending ? 'Leaving…' : 'Leave'}</Button></DialogFoot>
  </Dialog>
}

function DeleteConfirm({ workspace }: { workspace: CloudWorkspaceView }) {
  const name = workspace.name
  const [typed, setTyped] = useState('')
  const remove = useDeleteWorkspace()
  const close = () => open()
  const go = () => remove.mutate({ id: workspace.id, name: typed }, { onSuccess: () => { toast(`${name} deleted`); navigate('/') } })
  return <Dialog size="narrow" label={`Delete ${name}?`} onClose={close}>
    <DialogHead title={`Delete ${name}?`} onClose={close} />
    <div className="flex flex-col gap-4 px-5 py-5 text-[13px]/[18px]">
      <span className="text-body">Every agent, chat and setting in {name} is deleted for everyone. You can’t undo this.</span>
      <label className="flex flex-col gap-1.5"><span className="font-medium">Type the team name</span><Input value={typed} autoFocus autoComplete="off" spellCheck={false} placeholder={name} onChange={(event) => setTyped(event.target.value)} className="h-9 text-[13px] phone:h-11" /></label>
    </div>
    <DialogFoot error={remove.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="button" variant="destructive" disabled={typed.trim() !== name.trim() || remove.isPending} onClick={go}>{remove.isPending ? 'Deleting…' : 'Delete team'}</Button></DialogFoot>
  </Dialog>
}
