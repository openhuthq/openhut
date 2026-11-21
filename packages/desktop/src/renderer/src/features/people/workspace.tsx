import { useState, type FormEvent } from 'react'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { WorkspaceLogo } from '@/features/cloud/switcher'
import { useDeleteWorkspace, useRemoveMember, useRename, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open, useOpen } from '@/lib/router'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const RED = 'bg-[oklch(55%_0.2_25)] text-white not-disabled:hover:bg-[oklch(50%_0.2_25)] not-disabled:hover:text-white'

export function WorkspaceSettings() {
  const { active } = useWorkspaces()
  const rename = useRename()
  if (!active) return null
  const { name } = active
  const save = (value: string) => {
    if (value.trim() && value.trim() !== name) rename.mutate({ id: active.id, name: value }, { onSuccess: () => toast('Workspace renamed') })
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save(String(new FormData(event.currentTarget).get('name') ?? ''))
  }
  return <section className="flex flex-col gap-2">
    <form onSubmit={submit} className="flex items-end gap-3 px-1">
      <WorkspaceLogo workspace={active} size={36} />
      <label className="grid flex-1 gap-1">
        <span className="text-[12px] text-mute">Workspace name</span>
        <Input key={name} name="name" defaultValue={name} maxLength={60} disabled={active.role === 'member' || rename.isPending} onBlur={(event) => save(event.currentTarget.value)} className="h-9 text-[13.5px]" />
      </label>
    </form>
    {active.role === 'member' && <p className="m-0 px-1 text-[12px] text-mute">Only an owner or admin can rename it.</p>}
    <ErrorNote message={rename.error?.message} />
  </section>
}

export function WorkspaceDanger() {
  const { active } = useWorkspaces()
  const opened = useOpen()
  if (!active || active.own) return null
  return <>
    <DangerZone workspace={active} />
    {opened === 'leave' && <LeaveConfirm workspace={active} />}
    {opened === 'delete' && active.role !== 'member' && <DeleteConfirm workspace={active} />}
  </>
}

function DangerZone({ workspace }: { workspace: CloudWorkspaceView }) {
  const name = workspace.name
  const owner = workspace.role === 'owner'
  const rows: [string, string, string, string, boolean][] = [
    [`Leave ${name}`, owner ? 'Make someone else the owner first.' : 'For good. What you made stays with the workspace.', 'Leave', 'leave', owner],
    ...workspace.role === 'member' ? [] : [['Delete this workspace', 'Deletes everything in it for everyone.', 'Delete workspace', 'delete', false] as [string, string, string, string, boolean]],
  ]
  return <section className="flex flex-col gap-2.5">
    <span className="px-1 text-[13.5px] font-semibold">Danger zone</span>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-[oklch(75%_0.12_25)]">
      {rows.map(([title, note, action, dialog, off]) => <div key={title} className="flex items-center gap-4 px-4 py-3.5">
        <span className="grid flex-1 gap-0.5"><span className="text-[13.5px] font-semibold">{title}</span><span className="text-[12.5px] text-body">{note}</span></span>
        <Button type="button" variant="danger" disabled={off} title={off ? note : undefined} className="h-8 shrink-0 rounded-md border border-hair px-3 text-[12.5px]" onClick={() => open(dialog)}>{action}</Button>
      </div>)}
    </div>
  </section>
}

function LeaveConfirm({ workspace }: { workspace: CloudWorkspaceView }) {
  const name = workspace.name
  const leave = useRemoveMember()
  const { email } = useWorkspaces()
  const close = () => open()
  const go = () => leave.mutate({ id: workspace.id, email: email ?? '' }, { onSuccess: () => { toast(`You left ${name}`); navigate('/') } })
  return <Dialog size="narrow" label={`Leave ${name}?`} onClose={close}>
    <DialogHead title={`Leave ${name}?`} onClose={close} />
    <div className="px-5 py-5 text-[13px]/[18px] text-body">You lose access to its agents, chats and memory. What you made stays with {name}. To come back, ask an admin for a new invite.</div>
    <DialogFoot error={leave.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="button" variant="danger" className={RED} disabled={leave.isPending} onClick={go}>{leave.isPending ? 'Leaving…' : 'Leave'}</Button></DialogFoot>
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
      <span className="text-body">Every agent, chat and memory in {name} is deleted for everyone. This can’t be undone.</span>
      <label className="flex flex-col gap-1.5"><span className="font-medium">Type the workspace name</span><Input value={typed} autoFocus autoComplete="off" spellCheck={false} placeholder={name} onChange={(event) => setTyped(event.target.value)} className="h-9 text-[13px]" /></label>
    </div>
    <DialogFoot error={remove.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="button" variant="danger" className={cn(RED)} disabled={typed.trim() !== name.trim() || remove.isPending} onClick={go}>{remove.isPending ? 'Deleting…' : 'Delete workspace'}</Button></DialogFoot>
  </Dialog>
}
