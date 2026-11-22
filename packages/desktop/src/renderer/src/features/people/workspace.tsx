import { useEffect, useRef, useState } from 'react'
import { Delete02Icon, Key01Icon, Logout03Icon, PencilEdit02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { TeamMark } from '@/components/custom/team-mark'
import { useCloud } from '@/features/cloud/api'
import { Pitch } from '@/features/cloud/sign-in'
import { CloudSetup } from '@/features/cloud/setup'
import { isPhone } from '@/lib/native'
import { chooseWorkspace, peopleNote, useChangeKeys, useDeleteWorkspace, useRemoveMember, useRename, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { I, PILL } from '@/components/kit'
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
    <Rows>
      {all.map((workspace) => <TeamRow key={workspace.id} workspace={workspace} current={workspace.id === active.id} renaming={kind === 'rename' && id === workspace.id} />)}
      {!isPhone() && <Row onClick={() => open('join-link')} icon={<span className="grid size-8 place-items-center rounded-lg bg-soft text-mute"><I icon={PlusSignIcon} size={16} /></span>} title="Join another team" note="Paste an invite link" />}
    </Rows>
    {target && kind === 'keys' && target.role !== 'member' && <KeysConfirm workspace={target} />}
    {target && kind === 'leave' && !target.own && <LeaveConfirm workspace={target} />}
    {target && kind === 'delete' && target.role !== 'member' && !target.own && <DeleteConfirm workspace={target} />}
  </>
}

function TeamRow({ workspace, current, renaming }: { workspace: CloudWorkspaceView; current: boolean; renaming: boolean }) {
  const admin = workspace.role !== 'member'
  const owner = workspace.role === 'owner'
  const go = (kind: string) => open(`${kind}:${workspace.id}`)
  const title = renaming && admin ? <TeamNameInput workspace={workspace} /> : <span className="flex min-w-0 items-center gap-1.5">
    <span className="truncate" onDoubleClick={admin ? () => go('rename') : undefined}>{workspace.name}</span>
    {current && <span className="rounded-full bg-soft px-1.5 py-px text-[10.5px] font-medium text-mute">Current</span>}
    {admin && <Tooltip label="Rename"><Button type="button" variant="ghost" size="icon-xs" aria-label={`Rename ${workspace.name}`} onClick={() => go('rename')}><I icon={PencilEdit02Icon} size={13} className="text-mute" /></Button></Tooltip>}
  </span>
  return <Row icon={<TeamMark name={workspace.name} className="size-8 rounded-lg text-[14px]" />} title={title} note={`${peopleNote(workspace)} · you’re ${ROLE[workspace.role]}`}>
    {!current && <Button type="button" variant="ghost" className={PILL} onClick={() => { chooseWorkspace(workspace.id); navigate('/') }}>Switch</Button>}
    {admin && <Tooltip label="Reset encryption"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Reset encryption for ${workspace.name}`} onClick={() => go('keys')}><I icon={Key01Icon} size={16} className="text-hue-amber" /></Button></Tooltip>}
    {!workspace.own && <Tooltip label={owner ? 'Make someone else the owner to leave' : 'Leave'}><Button type="button" variant="ghost" size="icon-sm" aria-label={`Leave ${workspace.name}`} disabled={owner} onClick={() => go('leave')}><I icon={Logout03Icon} size={16} className="text-fail" /></Button></Tooltip>}
    {!workspace.own && admin && <Tooltip label="Delete team"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${workspace.name}`} onClick={() => go('delete')}><I icon={Delete02Icon} size={16} className="text-fail" /></Button></Tooltip>}
  </Row>
}

function TeamNameInput({ workspace }: { workspace: CloudWorkspaceView }) {
  const rename = useRename()
  const ref = useRef<HTMLSpanElement>(null)
  const { name } = workspace
  useEffect(() => {
    const field = ref.current
    if (!field) return
    field.focus()
    const range = document.createRange()
    range.selectNodeContents(field)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
  }, [])
  return <span ref={ref} role="textbox" aria-label="Team name" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false} className="block min-w-[2ch] truncate outline-none"
    onKeyDown={(event) => {
      if (event.key === 'Escape') event.currentTarget.textContent = name
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
    }}
    onBlur={(event) => {
      const value = (event.currentTarget.textContent ?? '').trim().slice(0, 60)
      if (value && value !== name) rename.mutate({ id: workspace.id, name: value }, { onSuccess: () => toast('Team renamed'), onError: toastError })
      else event.currentTarget.textContent = name
      open()
    }}>{name}</span>
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
