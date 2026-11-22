import { useState } from 'react'
import { Delete02Icon, Key01Icon, Logout03Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TeamMark } from '@/components/custom/team-mark'
import { useCloud } from '@/features/cloud/api'
import { Pitch } from '@/features/cloud/sign-in'
import { CloudSetup } from '@/features/cloud/setup'
import { JoinRow } from '@/features/join/cloud-join'
import { isPhone } from '@/lib/native'
import { peopleNote, useChangeKeys, useDeleteWorkspace, useRemoveMember, useRename, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { I, PILL, Section } from '@/components/kit'
import { Row, Rows } from '@/features/settings/kit'
import { cn } from '@/lib/utils'

const KEYS_NOTE = 'Use after a lost computer or a teammate you don’t trust. Everyone else stays in.'

const ROLE = { owner: 'the owner', admin: 'an admin', member: 'a member' }
const NAME = 'm-0 min-w-0 text-[18px]/[1.3] font-semibold tracking-[-.01em]'

export function TeamSettings() {
  const cloud = useCloud().data
  const { active } = useWorkspaces()
  const opened = useOpen()
  if (!cloud) return null
  const enabling = opened === 'enable' && <CloudSetup />
  const join = !isPhone() && <JoinRow />
  if (cloud.status === 'off' || !active) return <>{enabling}<Pitch />{join}</>
  return <>
    {enabling}
    <div className="flex items-center gap-3.5 px-1">
      <TeamMark name={active.name} className="size-12 rounded-xl text-[22px]" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <TeamName workspace={active} editing={opened === 'rename'} />
        <span className="text-[12px] text-mute">{peopleNote(active)} · you’re {ROLE[active.role]}</span>
      </span>
    </div>
    {join}
    <TeamDanger />
  </>
}

function TeamName({ workspace, editing }: { workspace: CloudWorkspaceView; editing: boolean }) {
  const rename = useRename()
  const { name } = workspace
  const can = workspace.role !== 'member'
  const shown = rename.isPending ? rename.variables.name : name
  if (!editing || !can) return <span className="flex min-w-0 items-center gap-1">
    <h3 className={cn(NAME, 'truncate')} title={can ? 'Double-click to rename' : undefined} onDoubleClick={can ? () => open('rename') : undefined}>{shown}</h3>
    {can && <Button type="button" variant="ghost" size="icon-xs" aria-label="Rename team" title="Rename" onClick={() => open('rename')}><I icon={PencilEdit02Icon} size={14} /></Button>}
  </span>
  return <Input autoFocus defaultValue={name} maxLength={60} aria-label="Team name" spellCheck={false} onFocus={(event) => event.currentTarget.select()} className={cn(NAME, 'h-8 px-1.5')}
    onKeyDown={(event) => {
      if (event.key === 'Escape') event.currentTarget.value = name
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
    }}
    onBlur={(event) => {
      const value = event.currentTarget.value.trim()
      if (value && value !== name) rename.mutate({ id: workspace.id, name: value }, { onSuccess: () => toast('Team renamed'), onError: toastError })
      open()
    }} />
}

function TeamDanger() {
  const { active } = useWorkspaces()
  const opened = useOpen()
  const changeKeys = useChangeKeys()
  const [changing, setChanging] = useState(false)
  if (!active) return null
  const name = active.name
  const owner = active.role === 'owner'
  const admin = active.role !== 'member'
  const changed = () => {
    notify({ title: 'Encryption reset', note: 'Everyone else stays in.' })
    if (active.own) navigate('/settings/account?open=kit')
  }
  return <Section title="Danger zone">
    <Rows>
      {admin && <Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Reset encryption" note={KEYS_NOTE}>
        <Button type="button" variant="secondary" className={cn(PILL, 'text-fail')} disabled={changeKeys.isPending} onClick={() => setChanging(true)}>Reset encryption</Button>
      </Row>}
      {!active.own && <Row icon={<I icon={Logout03Icon} size={20} className="text-fail" />} title={`Leave ${name}`} note={owner ? 'Make someone else the owner first.' : 'For good. What you made stays with the team.'}>
        <Button type="button" variant="secondary" className={cn(PILL, 'text-fail')} disabled={owner} onClick={() => open('leave')}>Leave</Button>
      </Row>}
      {!active.own && admin && <Row icon={<I icon={Delete02Icon} size={20} className="text-fail" />} title="Delete team" note="Deletes everything in it for everyone.">
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
