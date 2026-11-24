import { useEffect, useRef } from 'react'
import { LockSync01Icon, Logout03Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { TeamMark } from '@/components/custom/team-mark'
import { useChangeKeys, useRemoveMember, useRename, useSetWebsite, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { I, PILL } from '@/components/kit'
import { TeamPeople } from '@/features/people/people'
import { Row, Rows } from '@/features/settings/kit'
import { cn } from '@/lib/utils'

const KEYS_NOTE = 'Locks out lost computers and people you removed. Everyone else stays in.'

export function TeamSettings() {
  const { active } = useWorkspaces()
  const opened = useOpen()
  const admin = active.role !== 'member'
  return <>
    <TeamHeader workspace={active} editing={admin ? opened ?? undefined : undefined} />
    {opened === 'leave' && !active.own && <LeaveConfirm workspace={active} />}
  </>
}

export function PeopleSettings() {
  return <TeamPeople workspace={useWorkspaces().active} />
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
  return <div className="flex items-center gap-3.5 px-2.5">
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

export function TeamDangerRows() {
  const workspace = useWorkspaces().active
  if (workspace.own) return null
  return <Row icon={<I icon={Logout03Icon} size={20} className="text-fail" />} title="Leave" note="You lose access. What you made stays with the team.">
    <Button type="button" variant="secondary" className={cn(PILL, 'text-fail')} onClick={() => open('leave')}>Leave</Button>
  </Row>
}

export function ResetEncryptionRow() {
  const workspace = useWorkspaces().active
  const opened = useOpen()
  if (workspace.role === 'member') return null
  return <Row icon={<I icon={LockSync01Icon} size={20} className="text-hue-amber" />} title="Reset encryption" note={KEYS_NOTE}>
    <Button type="button" variant="secondary" className={PILL} onClick={() => open('keys')}>Reset</Button>
    {opened === 'keys' && <KeysConfirm workspace={workspace} />}
  </Row>
}

function KeysConfirm({ workspace }: { workspace: CloudWorkspaceView }) {
  const changeKeys = useChangeKeys()
  const reset = useRef(false)
  const changed = () => {
    notify({ title: 'Encryption reset', note: 'Everyone else stays in.' })
    reset.current = true
  }
  const close = () => (reset.current && workspace.own ? navigate('/settings/security?open=kit') : open())
  return <ConfirmDialog open onOpenChange={(still) => still || close()} question={`Reset encryption for ${workspace.name}?`} detail={workspace.own ? `${KEYS_NOTE} You save a new recovery kit after.` : KEYS_NOTE} action="Reset encryption" onConfirm={() => changeKeys.mutateAsync(workspace.id).then(changed)} />
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
