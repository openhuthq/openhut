import { useState, type FormEvent } from 'react'
import { MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TeamMark } from '@/components/custom/team-mark'
import { useCloud } from '@/features/cloud/api'
import { Pitch } from '@/features/cloud/sign-in'
import { CloudSetup } from '@/features/cloud/setup'
import { JoinRow } from '@/features/join/cloud-join'
import { isPhone } from '@/lib/native'
import { chooseWorkspace, peopleNote, useChangeKeys, useDeleteWorkspace, useRemoveMember, useRename, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open, useOpen } from '@/lib/router'
import { toast } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { I, PILL, Section } from '@/components/kit'
import { Row, Rows } from '@/features/settings/kit'

const KEYS_NOTE = 'Use after a lost computer or a teammate you don’t trust. Everyone else stays in.'

const ROLE = { owner: 'the owner', admin: 'an admin', member: 'a member' }

export function TeamSettings() {
  const cloud = useCloud().data
  const { all, active } = useWorkspaces()
  const opened = useOpen()
  if (!cloud) return null
  const enabling = opened === 'enable' && <CloudSetup />
  if (cloud.status === 'off' || !active) return <>{enabling}<Pitch /></>
  const [kind, id] = (opened ?? '').split(':')
  const target = all.find((each) => each.id === id)
  return <>
    {enabling}
    <Section title="Your teams">
      <Rows>{all.map((workspace) => <TeamRow key={workspace.id} workspace={workspace} current={workspace.id === active.id} />)}</Rows>
    </Section>
    {!isPhone() && <JoinRow />}
    {target && kind === 'rename' && target.role !== 'member' && <RenameDialog workspace={target} />}
    {target && kind === 'keys' && target.role !== 'member' && <KeysConfirm workspace={target} />}
    {target && kind === 'leave' && !target.own && <LeaveConfirm workspace={target} />}
    {target && kind === 'delete' && target.role !== 'member' && !target.own && <DeleteConfirm workspace={target} />}
  </>
}

function TeamRow({ workspace, current }: { workspace: CloudWorkspaceView; current: boolean }) {
  const admin = workspace.role !== 'member'
  const owner = workspace.role === 'owner'
  const go = (kind: string) => open(`${kind}:${workspace.id}`)
  return <Row icon={<TeamMark name={workspace.name} className="size-8 rounded-lg text-[14px]" />} title={<span className="flex items-center gap-2">{workspace.name}{current && <span className="rounded-full bg-soft px-1.5 py-px text-[10.5px] font-medium text-mute">Current</span>}</span>} note={`${peopleNote(workspace)} · you’re ${ROLE[workspace.role]}`}>
    {!current && <Button type="button" variant="ghost" className={PILL} onClick={() => { chooseWorkspace(workspace.id); navigate('/') }}>Switch</Button>}
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More options for ${workspace.name}`} title="More" />}><I icon={MoreHorizontalIcon} size={16} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px] rounded-xl p-1.5 shadow-menu">
        {admin && <DropdownMenuItem className="h-8 px-2.5" onClick={() => go('rename')}>Rename</DropdownMenuItem>}
        {admin && <DropdownMenuItem className="h-8 px-2.5" onClick={() => go('keys')}>Reset encryption</DropdownMenuItem>}
        {!workspace.own && <DropdownMenuItem className="h-8 px-2.5 text-fail" disabled={owner} onClick={() => go('leave')}>{owner ? 'Leave (make someone else owner first)' : 'Leave'}</DropdownMenuItem>}
        {!workspace.own && admin && <DropdownMenuItem className="h-8 px-2.5 text-fail" onClick={() => go('delete')}>Delete team</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  </Row>
}

function RenameDialog({ workspace }: { workspace: CloudWorkspaceView }) {
  const rename = useRename()
  const close = () => open()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name || name === workspace.name) return close()
    rename.mutate({ id: workspace.id, name }, { onSuccess: () => { toast('Team renamed'); close() } })
  }
  return <Dialog size="narrow" label="Rename team" onClose={close}>
    <DialogHead title="Rename team" onClose={close} />
    <form id="rename-team" onSubmit={submit} className="px-5 py-5">
      <Input name="name" defaultValue={workspace.name} required maxLength={60} autoFocus aria-label="Team name" onFocus={(event) => event.currentTarget.select()} className="h-9 text-[13px]" />
    </form>
    <DialogFoot error={rename.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="submit" form="rename-team" variant="primary" disabled={rename.isPending}>{rename.isPending ? 'Saving…' : 'Save'}</Button></DialogFoot>
  </Dialog>
}

function KeysConfirm({ workspace }: { workspace: CloudWorkspaceView }) {
  const changeKeys = useChangeKeys()
  const changed = () => {
    notify({ title: 'Encryption reset', note: 'Everyone else stays in.' })
    if (workspace.own) navigate('/settings/account?open=kit')
  }
  return <ConfirmDialog open onOpenChange={(still) => still || open()} question={`Reset encryption for ${workspace.name}?`} detail={workspace.own ? `${KEYS_NOTE} You save a new recovery kit after.` : KEYS_NOTE} action="Change keys" onConfirm={() => changeKeys.mutateAsync(workspace.id).then(changed)} />
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
