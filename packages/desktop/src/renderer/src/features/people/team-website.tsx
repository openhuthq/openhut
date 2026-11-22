import { useState } from 'react'
import { siteHost, type CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useSetWebsite } from '@/features/cloud/workspaces'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { toast } from '@/lib/toast'

const HINT = 'Its icon becomes the team’s mark.'
const BAD = 'Enter a website like example.com.'

export function TeamWebsiteDialog({ workspace, onClose }: { workspace: CloudWorkspaceView; onClose: () => void }) {
  const save = useSetWebsite()
  const [error, setError] = useState<string>()
  const title = workspace.website ? 'Team website' : 'Add website'
  const set = (website: string | null) => save.mutate({ id: workspace.id, website }, { onSuccess: () => { toast(website ? 'Website saved' : 'Website removed'); onClose() } })
  const remove = workspace.website && <Button type="button" variant="secondary" className="text-fail" disabled={save.isPending} onClick={() => set(null)}>Remove</Button>
  return <Dialog size="narrow" label={title} onClose={onClose}>
    <DialogHead title={title} subtitle={`${workspace.name}’s own site. ${HINT}`} onClose={onClose} />
    <form id="team-website" className="px-5 py-5" onSubmit={(event) => {
      const value = formValues(event)('website').trim()
      if (!value) return workspace.website ? set(null) : onClose()
      const host = siteHost(value)
      setError(host ? undefined : BAD)
      if (host && host !== workspace.website) set(host)
      if (host === workspace.website) onClose()
    }}>
      <Field label={<span className="text-xs font-medium text-mute">Website</span>} error={error ?? fieldError(save.error, 'website')}>{(control) =>
        <Input {...control} name="website" autoFocus defaultValue={workspace.website ?? ''} placeholder="example.com" inputMode="url" autoComplete="url" spellCheck={false} maxLength={200} onChange={() => setError(undefined)} className="h-9 text-[13px] phone:h-11" />}</Field>
    </form>
    <DialogFoot error={formError(save.error, ['website'])} start={remove}>
      <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit" form="team-website" variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
    </DialogFoot>
  </Dialog>
}
