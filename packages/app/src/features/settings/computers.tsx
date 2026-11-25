import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Cancel01Icon, Copy01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { Computer, ComputerJoin } from '@openhut/common/computers/computer.ts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I, PILL } from '@/components/kit'
import { DEVICE_HUE, DEVICE_ICONS } from '@/components/custom/device'
import { useComputerAdmins, useComputers, useJoinComputer, useRemoveComputer } from '@/features/computers/api'
import { useIsAdmin } from '@/features/people/api'
import { Chevron, Row, Rows } from '@/features/settings/kit'
import { copyText } from '@/lib/clipboard'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { open, useOpen } from '@/lib/router'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function ComputersSettings() {
  const computers = useComputers()
  const admin = useIsAdmin()
  const updating = useComputerAdmins().data?.[0]?.admin?.server.update?.status === 'running'
  const [uninstall, setUninstall] = useState<{ name: string; command: string }>()
  return <>
    <ErrorNote message={computers.error?.message} />
    <Rows>
      {computers.data?.map((computer) => <ComputerRow key={computer.id} computer={computer} admin={admin} updating={computer.here && updating} onRemoved={setUninstall} />)}
      {admin && <Row onClick={() => open('add-computer')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-green" />} title="Add a computer" note="Run agents on another Linux machine. You manage it from here."><Chevron /></Row>}
    </Rows>
    {useOpen() === 'add-computer' && <AddComputer />}
    {uninstall && <DialogCard onClose={() => setUninstall(undefined)}>
      <Head title={`${uninstall.name} is removed`} onClose={() => setUninstall(undefined)} />
      <p className="m-0 text-[13px]/[18px] text-body">It can’t connect anymore. To delete OpenHut and its data from that machine, run this there:</p>
      <Command text={uninstall.command} />
    </DialogCard>}
  </>
}

function ComputerRow({ computer, admin, updating, onRemoved }: { computer: Computer; admin: boolean; updating: boolean; onRemoved: (removed: { name: string; command: string }) => void }) {
  const remove = useRemoveComputer()
  const [asking, setAsking] = useState(false)
  return <Row icon={<ComputerMark computer={computer} />} title={computer.here ? <>{computer.name} <span className="text-mute">· this machine</span></> : computer.name} note={updating ? 'Updating…' : noteOf(computer)}>
    {updating && <Spinner className="mt-0" />}
    {admin && !computer.here && <Button type="button" variant="secondary" className={cn(PILL, 'text-fail')} disabled={remove.isPending} onClick={() => setAsking(true)}>Remove</Button>}
    <ConfirmDialog open={asking} onOpenChange={setAsking} question={`Remove ${computer.name}?`} detail="It disconnects and can’t run agents for this install anymore. You can add it again later." action="Remove"
      onConfirm={() => remove.mutate({ id: computer.id }, { onSuccess: (removed) => onRemoved({ name: computer.name, command: removed.uninstall }), onError: (error) => toast(`Couldn’t remove ${computer.name}`, error.message) })} />
  </Row>
}

export function noteOf(computer: Computer): string {
  const seen = computer.seenAt ? `Offline since ${new Date(computer.seenAt).toLocaleString()}` : 'Offline'
  const parts = [
    computer.online ? 'Online' : seen,
    computer.gvisor !== null && `gVisor: ${computer.gvisor ? 'on' : 'off'}`,
    computer.version && `OpenHut ${computer.version}`,
    computer.agents ? `${computer.agents} agent${computer.agents === 1 ? '' : 's'}` : 'No agents',
  ]
  const note = parts.filter(Boolean).join(' · ')
  return computer.updateError ? `${note}. Couldn’t update: ${computer.updateError}` : note
}

function ComputerMark({ computer }: { computer: Computer }) {
  return <span className="relative inline-grid place-items-center">
    <I icon={DEVICE_ICONS.server} size={20} className={DEVICE_HUE} />
    <i className={cn('absolute -right-1 -bottom-0.5 size-2.5 rounded-full border-2 border-card', computer.online ? 'bg-pass' : 'bg-mute-2')} />
  </span>
}

function AddComputer() {
  const client = useQueryClient()
  const join = useJoinComputer()
  const { mutate } = join
  useEffect(() => mutate(), [mutate])
  const joined = useJoined(join.data)
  const now = useNow(!!join.data && !joined)
  const left = join.data ? Math.max(0, Date.parse(join.data.expiresAt) - now) : 0
  const close = () => {
    void client.invalidateQueries({ queryKey: COMPUTERS_KEY })
    open()
  }
  useEffect(() => {
    if (!joined) return
    toast(`${joined.name} is connected`, 'New agents can run on it now, and you can move agents to it from their Runs on menu.')
    void client.invalidateQueries({ queryKey: COMPUTERS_KEY })
    open()
  }, [joined, client])
  return <DialogCard onClose={close}>
    <Head title="Add a computer" onClose={close} />
    <div className="flex flex-col gap-4 text-[13px]/[18px]">
      <ErrorNote message={join.error?.message} />
      {join.isPending && <p className="m-0 flex items-center gap-2 text-mute"><Spinner className="mt-0" />Making a command…</p>}
      {join.data && <>
        <p className="m-0 text-body">Run this on the other machine. It needs Linux with Docker.</p>
        <Command text={join.data.command} />
        <p className="m-0 text-[12px]/[16px] text-mute">{left ? `Expires in ${Math.ceil(left / 60_000)} minutes, works once.` : 'This command expired.'} The machine connects out to this server, so it can sit behind a firewall.</p>
        {left > 0 && <p className="m-0 flex items-center gap-2 text-mute"><Spinner className="mt-0" />Waiting for it to connect…</p>}
        {!left && <div><Button type="button" variant="secondary" className={PILL} onClick={() => mutate()}>Make a new command</Button></div>}
      </>}
    </div>
  </DialogCard>
}

function useJoined(join: ComputerJoin | undefined): Computer | undefined {
  const computers = useComputers({ watching: !!join })
  return join ? computers.data?.find((computer) => computer.id === join.computer.id && computer.online) : undefined
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="flex items-center gap-3">
    <DialogTitle className="flex-1 text-[15px]/[22px] font-medium">{title}</DialogTitle>
    <Button type="button" size="icon-sm" aria-label="Close" className="-mr-1" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
  </div>
}

function Command({ text }: { text: string }) {
  return <div className="flex items-start gap-2 rounded-lg bg-soft p-3">
    <code className="min-w-0 flex-1 font-mono text-[12.5px]/[18px] break-all text-ink select-all">{text}</code>
    <Button type="button" variant="bare" className="flex shrink-0 items-center gap-1 text-[12.5px] text-body hover:text-ink" onClick={() => void copyText(text).then((copied) => { if (copied) toast('Copied') })}><I icon={Copy01Icon} size={13} />Copy</Button>
  </div>
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [ticking])
  return now
}
