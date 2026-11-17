import { useMutation, useQuery } from '@tanstack/react-query'
import { CloudDownloadIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { I, PILL, Section, Status } from '@/components/kit'
import { useComputerAdmins, useUpdateComputer, type ComputerAdmin } from '@/features/computers/api'
import { ComputerMark } from '@/features/settings/computers'
import { desktop } from '@/features/settings/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { toastError } from '@/lib/toast'

export function UpdatesSettings() {
  const computers = useComputerAdmins().data ?? []
  return <>
    <Section title="This app"><Rows><AppRow /></Rows></Section>
    {computers.length > 1 && <Section title="Computers"><Rows>{computers.map((each) => <ComputerRow key={each.computer.id} entry={each} />)}</Rows></Section>}
  </>
}

function AppRow() {
  const updates = desktop?.updates
  const status = useQuery({ queryKey: ['app-update'], queryFn: () => updates?.status(), enabled: !!updates })
  const install = useMutation({ mutationFn: async () => updates?.install(), onError: toastError })
  const update = status.data
  return <Row icon={<I icon={CloudDownloadIcon} size={20} className="text-hue-sky" />} title="OpenHut" note={update?.version ?? appVersion()}>
    {update?.state === 'ready' && <Button variant="primary" className={PILL} disabled={install.isPending} onClick={() => install.mutate()}>Restart to update</Button>}
    {update?.state === 'idle' && <Status tone="on">Up to date</Status>}
    {(update?.state === 'checking' || update?.state === 'available' || update?.state === 'downloading') && <Updating label="Downloading…" />}
    {update?.state === 'error' && <Status tone="bad">Couldn't check</Status>}
  </Row>
}

function ComputerRow({ entry: { computer, admin } }: { entry: ComputerAdmin }) {
  const start = useUpdateComputer()
  const server = admin?.server
  const local = computer.id === 'local'
  return <Row icon={<ComputerMark computer={computer} />} title={computer.name} note={server?.version ?? (computer.online ? undefined : 'Offline')}>
    {!local && server && (server.update?.status === 'running' || start.isPending
      ? <Updating label="Updating…" />
      : server.updateAvailable
        ? <Button variant="secondary" className={PILL} onClick={() => start.mutate(computer, { onError: toastError })}>Update</Button>
        : <Status tone="on">Up to date</Status>)}
  </Row>
}

function Updating({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1.5"><Spinner className="mt-0" />{label}</span>
}

function appVersion() {
  return /OpenHut(?: ?Dev)?\/([\d.]+)/.exec(navigator.userAgent)?.[1]
}
