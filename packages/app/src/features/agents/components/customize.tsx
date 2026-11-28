import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DialogCard, I } from '@/components/kit'
import { useUpdateAgent } from '@/lib/queries/agents'
import { lookOf } from '@/components/agent-face'
import { FacePicker } from '@/features/agents/components/face-picker'
import { checkName } from '@/features/agents/form'
import { formValues } from '@/lib/form'

export function CustomizeDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <DialogCard onClose={onClose} className="max-h-[calc(100vh-32px)] w-[480px] items-center p-6 text-center [&_form>*]:shrink-0">
    <form className="contents" onSubmit={(event) => {
      const field = formValues(event)
      updateAgent.mutate({ name: field('name').trim(), face: field('face') }, { onSuccess: onClose })
    }}>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" className="absolute top-3 right-3 rounded-full" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
      <DialogTitle className="text-[15px]/[22px] font-medium">Customize</DialogTitle>
      <FacePicker initial={agent.face ?? JSON.stringify(lookOf(agent))} />
      <Input name="name" autoComplete="off" required maxLength={40} defaultValue={agent.name} aria-label="Name" onInput={(event) => checkName(event.currentTarget)} className="h-10 rounded-lg text-center text-base font-medium" />
      <Button type="submit" variant="primary" size="lg" className="h-10 w-full justify-center" disabled={updateAgent.isPending}>{updateAgent.isPending ? 'Saving…' : 'Save'}</Button>
      {updateAgent.error && <p role="alert" className="m-0 text-xs text-fail">{updateAgent.error.message}</p>}
    </form>
  </DialogCard>
}
