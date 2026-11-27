import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Key01Icon } from '@hugeicons/core-free-icons'
import { Deleted, List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { AgentSecret } from '@openhut/common/agents/secret.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { I, Loading } from '@/components/kit'
import { EmptyScene } from '@/components/empty-art'
import { request } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { ago } from '@/lib/format'
import { toastError } from '@/lib/toast'

const SECRET_LIST = List(AgentSecret)
const DELETED_SECRET = Deleted('agent_secret')
const secretsKey = (agentId: string) => ['agent-secrets', agentId]

function useSecrets(agentId: string) {
  return useQuery({ queryKey: secretsKey(agentId), queryFn: () => request({ schema: SECRET_LIST, of: agentId, path: `/api/agent-secrets?${new URLSearchParams({ agentId })}` }).then((page) => page.data) })
}

function useReplaceSecret(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => request({ schema: AgentSecret, of: agentId, path: `/api/agent-secrets/${encodeURIComponent(id)}`, method: 'POST', body: { value } }),
    onSuccess: (saved) => client.setQueryData<AgentSecret[]>(secretsKey(agentId), (all) => all?.map((each) => each.id === saved.id ? saved : each)),
  })
}

function useDeleteSecret(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request({ schema: DELETED_SECRET, of: agentId, path: `/api/agent-secrets/${encodeURIComponent(id)}`, method: 'DELETE' }),
    onSuccess: ({ id }) => client.setQueryData<AgentSecret[]>(secretsKey(agentId), (all) => all?.filter((each) => each.id !== id)),
  })
}

export function KeysList({ agent }: { agent: Agent }) {
  const secrets = useSecrets(agent.id)
  return <>
      <ErrorNote message={secrets.error?.message} />
      {!secrets.data && !secrets.error && <Loading />}
      {secrets.data && (secrets.data.length
        ? secrets.data.map((secret) => <KeyRow key={secret.id} agent={agent} secret={secret} />)
        : <EmptyScene kind="vault" title="The vault is empty" line={`When ${agent.name} needs a key, it asks in the chat and keeps it here.`} />)}
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
