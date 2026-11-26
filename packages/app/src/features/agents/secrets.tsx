import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight01Icon, Cancel01Icon, Key01Icon, SquareLock01Icon } from '@hugeicons/core-free-icons'
import { Deleted, List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { AgentSecret } from '@openhut/common/agents/secret.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I, Loading, ROW, ROW_VALUE } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { DetailRow, Details, Quiet, RequestCard } from '@/features/agents/request-card'
import type { CardProps } from '@/features/agents/change-requests'
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

export function SecretCard({ agent, change, busy, error, send }: CardProps) {
  const client = useQueryClient()
  const name = String(change.input.name ?? '')
  const hosts = Array.isArray(change.input.hosts) ? change.input.hosts.map(String) : []
  const form = `secret-${change.id}`
  const save = (value: string) => {
    send('approve', { answer: { value } })
    void client.invalidateQueries({ queryKey: secretsKey(agent.id) })
  }
  return <RequestCard agent={agent} change={change} error={error} decided={change.status === 'done' ? { label: 'Key saved', tone: 'success' } : undefined}
    icon={<I icon={Key01Icon} size={22} className="text-hue-amber" />} action={{ icon: SquareLock01Icon, hue: 'text-hue-green' }}
    title={<>{agent.name} needs a key: <b>{name}</b></>}
    actions={<>
      <Button type="submit" form={form} variant="primary" size="sm" disabled={busy}>Save key</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => send('deny', {})}>Not now</Button>
    </>}>
    <span className="text-[13px] text-body">{agent.name} never sees it. It's only sent to {hosts.join(', ')}.</span>
    {change.status === 'open' && agent.canEdit && <form id={form} onSubmit={(event) => save(formValues(event)('value'))}>
      <Input type="password" name="value" aria-label={`Paste the ${name} key`} placeholder={`Paste the ${name} key`} autoComplete="off" spellCheck={false} required maxLength={4000} />
    </form>}
    <Details>
      <DetailRow label="Sent as"><code className="font-mono text-[12px]">{String(change.input.header ?? '')}</code></DetailRow>
      <DetailRow label="Only to">{hosts.join(', ')}</DetailRow>
    </Details>
  </RequestCard>
}

export function KeysRow({ agent }: { agent: Agent }) {
  const count = useSecrets(agent.id).data?.length
  return <a className={ROW} href={agentPath({ agentId: agent.id, dialog: 'keys' })}><I icon={Key01Icon} size={15} className="text-hue-amber" />Keys<span className={ROW_VALUE}>{count || ''}<I icon={ArrowRight01Icon} size={12} className="text-mute" /></span></a>
}

export function KeysDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const secrets = useSecrets(agent.id)
  return <DialogCard onClose={onClose} className="max-h-[min(640px,calc(100vh-48px))] w-[480px] gap-0 overflow-hidden p-0">
    <div className="flex items-center gap-3 px-6 pt-6 pb-3">
      <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">Keys {agent.name} can use</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mr-2" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-5">
      <ErrorNote message={secrets.error?.message} />
      {!secrets.data && !secrets.error && <Loading />}
      {secrets.data && (secrets.data.length
        ? secrets.data.map((secret) => <KeyRow key={secret.id} agent={agent} secret={secret} />)
        : <Quiet agent={agent} line={`No keys yet. When ${agent.name} needs one, it asks in the chat.`} />)}
    </div>
  </DialogCard>
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
