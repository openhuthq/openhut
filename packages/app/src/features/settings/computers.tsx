import type { Admin } from '@openhut/common/admin/admin.ts'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { DEVICE_HUE, DEVICE_ICONS } from '@/components/custom/device'
import { useAgents } from '@/features/agents/api'
import { useComputerAdmins, useComputers } from '@/features/computers/api'
import { Intro, Row, Rows } from '@/features/settings/kit'
import type { Computer } from '@/lib/openhut'
import { cn } from '@/lib/utils'

export function ComputersSettings() {
  const computers = useComputers()
  const admin = useComputerAdmins().data?.[0]?.admin
  const count = useAgents().data?.length ?? 0
  const local = computers.data?.[0]
  return <>
    <Intro>This server runs your agents. Adding more machines comes next.</Intro>
    <ErrorNote message={computers.error?.message} />
    <Rows>
      {local && <Row icon={<ComputerMark computer={local} />} title={local.name} note={admin?.server.update?.status === 'running' ? 'Updating…' : noteOf({ computer: local, admin, count })}>
        {admin?.server.update?.status === 'running' && <Spinner className="mt-0" />}
      </Row>}
    </Rows>
  </>
}

function noteOf({ computer, admin, count }: { computer: Computer; admin: Admin | undefined; count: number }) {
  if (!computer.online) return 'Offline'
  const failed = admin?.server.update?.status === 'failed' ? admin.server.update : null
  if (failed) return `Couldn't update to ${failed.to}. ${sentence(failed.reason ?? 'The update stopped before it finished.')}`
  return ['Connected now', agentCount(count), computer.version && `OpenHut ${computer.version}`].filter(Boolean).join(' · ')
}

function sentence(text: string) {
  const trimmed = text.trim()
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? '' : '.'}`
}

function agentCount(count: number) {
  if (!count) return 'No agents'
  return `${count} agent${count === 1 ? '' : 's'}`
}

function ComputerMark({ computer }: { computer: Computer }) {
  return <span className="relative inline-grid place-items-center">
    <I icon={DEVICE_ICONS.server} size={20} className={DEVICE_HUE} />
    <i className={cn('absolute -right-1 -bottom-0.5 size-2.5 rounded-full border-2 border-card', computer.online ? 'bg-pass' : 'bg-mute-2')} />
  </span>
}
