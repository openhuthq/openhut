import type { FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { WorkspaceLogo } from '@/features/cloud/switcher'
import { useRename, useWorkspaces, workspaceName } from '@/features/cloud/workspaces'
import { toast } from '@/lib/toast'

export function WorkspaceSettings() {
  const { active } = useWorkspaces()
  const rename = useRename()
  if (!active) return null
  const name = workspaceName(active)
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
