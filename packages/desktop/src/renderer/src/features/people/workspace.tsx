import { useEffect, useRef, useState } from 'react'
import { ArrowRight01Icon, Delete02Icon, Key01Icon, Logout03Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
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
import { useChangeKeys, useDeleteWorkspace, useRemoveMember, useRename, useSetWebsite, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { I, PILL } from '@/components/kit'
import { TeamPeople } from '@/features/people/people'
import { Row, Rows } from '@/features/settings/kit'
import { cn } from '@/lib/utils'

const KEYS_NOTE = 'Use after a lost computer or a teammate you don’t trust. Everyone else stays in.'


export function TeamGeneral() {
  const cloud = useCloud().data
  const { active } = useWorkspaces()
  const opened = useOpen()
  if (cloud?.status === 'off' || !active) return null
  const admin = active.role !== 'member'
  return <>
    <TeamHeader workspace={active} editing={admin ? opened ?? undefined : undefined} />
    <TeamPeople workspace={active} />
    <TeamMore workspace={active} />
    {opened === 'keys' && admin && <KeysConfirm workspace={active} />}
    {opened === 'leave' && !active.own && <LeaveConfirm workspace={active} />}
    {opened === 'delete' && admin && !active.own && <DeleteConfirm workspace={active} />}
  </>
}

function TeamHeader({ workspace, editing }: { workspace: CloudWorkspaceView; editing?: string }) {
  const rename = useRename()
  const setWebsite = useSetWebsite()
  const admin = workspace.role !== 'member'
  const saveName = (value: string) => {
    if (value && value !== workspace.name) rename.mutate({ id: workspace.id, name: value }, { onSuccess: () => toast('Team renamed'), onError: toastError })
  }
  const saveSite = (value: string) => {
    if (value === (workspace.website ?? '')) return
    setWebsite.mutate({ id: workspace.id, website: value || null }, { onSuccess: () => toast(value ? 'Website saved' : 'Website removed'), onError: toastError })
  }
  const pencil = (what: string, label: string) => admin && <Tooltip label={label}><Button type="button" variant="ghost" size="icon-xs" aria-label={label} className={cn(editing === what && 'invisible')} onClick={() => open(what)}><I icon={PencilEdit02Icon} size={13} className="text-mute" /></Button></Tooltip>
  return <div className="flex items-center gap-3.5 px-1">
    <TeamMark workspace={workspace} className="size-12 rounded-xl text-[22px]" />
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-[18px]/[1.3] font-semibold tracking-[-.01em]">
        {editing === 'rename' ? <InlineEdit value={workspace.name} label="Team name" onSave={saveName} /> : <span className="truncate" onDoubleClick={admin ? () => open('rename') : undefined}>{workspace.name}</span>}
        {pencil('rename', 'Rename')}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-[12.5px]/[18px] text-mute">
        {editing === 'site' ? <InlineEdit value={workspace.website ?? ''} label="Team website" placeholder="example.com" onSave={saveSite} />
          : workspace.website ? <span className="truncate" onDoubleClick={admin ? () => open('site') : undefined}>{workspace.website}</span>
          : admin ? <Button type="button" variant="text" className="h-auto p-0 text-[12.5px]/[18px] font-normal text-hue-blue" onClick={() => open('site')}>Add website</Button> : null}
        {workspace.website && pencil('site', 'Change website')}
      </span>
    </span>
  </div>
}

function InlineEdit({ value, label, placeholder, onSave }: { value: string; label: string; placeholder?: string; onSave: (value: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const field = ref.current
    if (!field) return
    field.focus()
    const range = document.createRange()
    range.selectNodeContents(field)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
  }, [])
  return <span ref={ref} role="textbox" aria-label={label} data-placeholder={placeholder} contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false} className="min-w-[2ch] truncate outline-none empty:before:text-mute-2 empty:before:content-[attr(data-placeholder)]"
    onKeyDown={(event) => {
      if (event.key === 'Escape') event.currentTarget.textContent = value
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
    }}
    onBlur={(event) => {
      onSave((event.currentTarget.textContent ?? '').trim().slice(0, 120))
      open()
    }}>{value}</span>
}

function TeamMore({ workspace }: { workspace: CloudWorkspaceView }) {
  const [shown, setShown] = useState(false)
  const admin = workspace.role !== 'member'
  const owner = workspace.role === 'owner'
  const rows: { title: string; note: string; action: string; dialog: string; danger: boolean; off?: boolean }[] = [
    ...admin ? [{ title: 'Reset encryption', note: KEYS_NOTE, action: 'Reset', dialog: 'keys', danger: false }] : [],
    ...workspace.own ? [] : [{ title: 'Leave', note: owner ? 'Make someone else the owner first.' : 'You lose access. What you made stays with the team.', action: 'Leave', dialog: 'leave', danger: true, off: owner }],
    ...workspace.own || !admin ? [] : [{ title: 'Delete team', note: 'Deletes everything in it for everyone.', action: 'Delete team', dialog: 'delete', danger: true }],
  ]
  if (!rows.length) return null
  return <div className="flex flex-col gap-1.5">
    <Button type="button" variant="ghost" aria-expanded={shown} className="w-fit gap-1.5 px-1.5 text-[12.5px] font-normal text-mute" onClick={() => setShown(!shown)}><I icon={ArrowRight01Icon} size={12} className={cn('transition-transform', shown && 'rotate-90')} />More options</Button>
    {shown && <Rows>{rows.map((row) => <Row key={row.dialog} icon={<I icon={row.dialog === 'keys' ? Key01Icon : row.dialog === 'leave' ? Logout03Icon : Delete02Icon} size={20} className={row.danger ? 'text-fail' : 'text-hue-amber'} />} title={row.title} note={row.note}>
      <Button type="button" variant={row.danger ? 'danger' : 'ghost'} className={PILL} disabled={row.off} onClick={() => open(row.dialog)}>{row.action}</Button>
    </Row>)}</Rows>}
  </div>
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
