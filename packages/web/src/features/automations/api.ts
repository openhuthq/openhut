import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Automation, AutomationRun, SendTarget, type CreateAutomation, type UpdateAutomation } from '@openhut/common/automations/automation.ts'
import { request } from '@/lib/api-client'

const AUTOMATION_LIST = List(Automation)
const RUN_LIST = List(AutomationRun)
const TARGET_LIST = List(SendTarget)
const DELETED_AUTOMATION = Deleted('automation')
const POLL_MS = 2_000

export function useAutomations(agentId: string) {
  return useQuery({
    queryKey: automationsKey(agentId),
    queryFn: () => request({ schema: AUTOMATION_LIST, path: `/api/automations?agentId=${encodeURIComponent(agentId)}` }).then((page) => page.data),
    refetchInterval: (query) => query.state.data?.some((automation) => automation.lastRun?.status === 'running') ? POLL_MS : false,
  })
}

export function useAutomationRuns(automationId: string) {
  return useQuery({
    queryKey: ['automation-runs', automationId],
    queryFn: () => request({ schema: RUN_LIST, path: `/api/automation-runs?automationId=${encodeURIComponent(automationId)}` }).then((page) => page.data),
    refetchInterval: (query) => query.state.data?.some((run) => run.status === 'running') ? POLL_MS : false,
  })
}

export function useSendTargets(agentId: string) {
  return useQuery({
    queryKey: ['send-targets', agentId],
    queryFn: () => request({ schema: TARGET_LIST, path: `/api/send-targets?agentId=${encodeURIComponent(agentId)}` }).then((page) => page.data),
  })
}

export function useCreateAutomation(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAutomation) => request({ schema: Automation, path: '/api/automations', method: 'POST', body }),
    onSuccess: (automation) => client.setQueryData<Automation[]>(automationsKey(agentId), (list) => list && [...list, automation]),
  })
}

export function useUpdateAutomation({ agentId, automationId }: { agentId: string; automationId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAutomation) => request({ schema: Automation, path: automationPath(automationId), method: 'PATCH', body }),
    onSuccess: (automation) => client.setQueryData<Automation[]>(automationsKey(agentId), (list) => list?.map((each) => each.id === automation.id ? automation : each)),
  })
}

export function useDeleteAutomation({ agentId, automationId }: { agentId: string; automationId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_AUTOMATION, path: automationPath(automationId), method: 'DELETE' }),
    onSuccess: () => client.setQueryData<Automation[]>(automationsKey(agentId), (list) => list?.filter((each) => each.id !== automationId)),
  })
}

export function useRunAutomation({ agentId, automationId }: { agentId: string; automationId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: AutomationRun, path: '/api/automation-runs', method: 'POST', body: { automationId } }),
    onSuccess: (run) => {
      client.setQueryData<AutomationRun[]>(['automation-runs', automationId], (runs) => [run, ...(runs ?? [])])
      client.setQueryData<Automation[]>(automationsKey(agentId), (list) => list?.map((each) => each.id === automationId ? { ...each, lastRun: { status: run.status, startedAt: run.startedAt } } : each))
    },
  })
}

function automationsKey(agentId: string) {
  return ['automations', agentId]
}

function automationPath(automationId: string) {
  return `/api/automations/${encodeURIComponent(automationId)}`
}
