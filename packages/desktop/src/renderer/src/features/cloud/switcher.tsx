import { type FormEvent } from 'react'
import { ArrowDown01Icon, Link01Icon, PlusSignIcon, Tick02Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { HOVER, I } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { chooseWorkspace, peopleNote, useCreateWorkspace, useWorkspaces } from '@/features/cloud/workspaces'
import { navigate, open } from '@/lib/router'
import { cn } from '@/lib/utils'

const LOGO = { 22: 'size-[22px] text-[13px]', 24: 'size-6 text-[14px]', 36: 'size-9 text-[21px]' }

export function WorkspaceLogo({ workspace, size = 24 }: { workspace: CloudWorkspaceView; size?: keyof typeof LOGO }) {
  const { name } = workspace
  if (workspace.members.length === 1 && workspace.home) return <PersonFace name={name} email={workspace.members[0]?.email ?? name} size={size} />
  return <span className={cn('grid shrink-0 place-items-center rounded-md bg-hue-violet leading-none font-bold text-white', LOGO[size])}>{name.charAt(0).toLowerCase()}</span>
}

export function Switcher() {
  const { all, active, email } = useWorkspaces()
  if (!active) return null
  return <DropdownMenu>
    <DropdownMenuTrigger className={cn('flex min-w-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-ink data-popup-open:bg-picked', HOVER)}>
      <WorkspaceLogo workspace={active} />
      <span className="truncate text-[14px] font-semibold">{active.name}</span>
      <I icon={ArrowDown01Icon} size={14} className="shrink-0 text-mute" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="flex w-[260px] flex-col gap-0.5 rounded-xl p-1.5 shadow-menu">
      <span className="px-2.5 pt-1 pb-1 text-[11.5px] text-mute">{email}</span>
      {all.map((workspace) => <DropdownMenuItem key={workspace.id} onClick={() => { chooseWorkspace(workspace.id); navigate('/') }} className={cn('h-auto gap-2.5 rounded-lg px-2.5 py-2', workspace.id === active.id && 'bg-soft')}>
        <WorkspaceLogo workspace={workspace} size={22} />
        <span className="grid flex-1 leading-tight"><span className="text-[13px] font-medium">{workspace.name}</span><span className="text-[11.5px] text-mute">{peopleNote(workspace)}</span></span>
        {workspace.id === active.id && <I icon={Tick02Icon} size={14} />}
      </DropdownMenuItem>)}
      <DropdownMenuSeparator />
      {active.role !== 'member' && <DropdownMenuItem className="h-8 gap-2.5 px-2.5 text-[13px]" onClick={() => navigate('/settings/people?open=invite')}><I icon={UserGroupIcon} size={15} className="text-mute" />Invite people</DropdownMenuItem>}
      {all.some((each) => each.own) && <DropdownMenuItem className="h-8 gap-2.5 px-2.5 text-[13px]" onClick={() => open('new-workspace')}><I icon={PlusSignIcon} size={15} className="text-mute" />Create another team</DropdownMenuItem>}
      <DropdownMenuItem className="h-8 gap-2.5 px-2.5 text-[13px]" onClick={() => open('join-link')}><I icon={Link01Icon} size={15} className="text-mute" />Join with a link</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

export function CreateWorkspaceDialog() {
  const create = useCreateWorkspace()
  const close = () => open()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate(String(new FormData(event.currentTarget).get('name') ?? '').trim(), { onSuccess: () => { close(); navigate('/settings/people') } })
  }
  return <Dialog size="narrow" label="Create a team" onClose={close}>
    <DialogHead title="Create a team" onClose={close} />
    <form id="new-workspace" onSubmit={submit} className="flex flex-col gap-3 px-5 py-5 text-[13px]/[18px]">
      <span className="text-body">A new workspace for agents you share. Your own workspace stays yours.</span>
      <Input name="name" required maxLength={60} autoFocus placeholder="Team name" aria-label="Team name" className="h-9 text-[13px]" />
    </form>
    <DialogFoot error={create.error?.message} start={<Button type="button" variant="secondary" onClick={close}>Cancel</Button>}><Button type="submit" form="new-workspace" variant="primary" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create'}</Button></DialogFoot>
  </Dialog>
}
