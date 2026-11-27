import { useState } from 'react'
import { Key01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { AgentSecret } from '@openhut/common/agents/secret.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { EmptyScene, SceneLoading } from '@/components/empty-art'
import { formValues } from '@/lib/form'
import { ago } from '@/lib/format'
import { toastError } from '@/lib/toast'
import { useDeleteSecret, useReplaceSecret, useSecrets } from '@/features/agents/api/secrets'

export function KeysList({ agent }: { agent: Agent }) {
  const secrets = useSecrets(agent.id)
  return <>
      <ErrorNote message={secrets.error?.message} />
      {!secrets.data && !secrets.error && <SceneLoading />}
      {secrets.data && (secrets.data.length
        ? secrets.data.map((secret) => <KeyRow key={secret.id} agent={agent} secret={secret} />)
        : <EmptyScene kind="vault" title="Nothing here yet" line={`When ${agent.name} needs a password or API key, it asks you in the chat.`} />)}
  </>
}

function KeyRow({ agent, secret }: { agent: Agent; secret: AgentSecret }) {
  const replace = useReplaceSecret(agent.id)
  const remove = useDeleteSecret(agent.id)
  const [replacing, setReplacing] = useState(false)
  return <div className="flex flex-col gap-2 rounded-lg px-2 py-2 hover:bg-hover">
    <div className="flex min-w-0 items-center gap-3">
      <I icon={Key01Icon} size={17} className="shrink-0 text-hue-amber" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-mono text-[12.5px] text-ink">{secret.name}</span>
        <span className="truncate text-[12px] text-mute">{secret.hosts.join(', ')} · {secret.usedAt ? `Used ${ago(secret.usedAt)} ago` : 'Not used yet'}</span>
      </span>
      {agent.canEdit && !replacing && <span className="flex shrink-0 gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(true)}>Replace</Button>
        <ConfirmButton size="sm" question={`Remove ${secret.name}?`} detail={`${agent.name} can't call ${secret.hosts.join(', ')} with it anymore.`} action="Remove"
          onConfirm={() => remove.mutateAsync(secret.id).catch(toastError)}>Remove</ConfirmButton>
      </span>}
    </div>
    {replacing && <form className="flex gap-2 pl-8" onSubmit={(event) => replace.mutate({ id: secret.id, value: formValues(event)('value') }, { onSuccess: () => setReplacing(false), onError: toastError })}>
      <Input type="password" name="value" aria-label={`New ${secret.name} key`} placeholder="Paste the new key" autoComplete="off" spellCheck={false} required maxLength={4000} autoFocus className="flex-1" />
      <Button type="submit" variant="primary" size="sm" disabled={replace.isPending}>Save</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(false)}>Cancel</Button>
    </form>}
  </div>
}
