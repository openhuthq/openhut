import { LaptopIcon, PlusSignIcon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import type { Device } from '@openhut/client'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { CloudDevices } from '@/features/cloud/cloud'
import { I, PILL } from '@/components/kit'
import { QrCode } from '@/features/agents/qr-code'
import { useDevices, useRemoveDevice } from '@/features/settings/api'
import { HERE } from '@/features/settings/desktop'
import { PairDialog, Waiting } from '@/features/settings/invite'
import { Chevron, Intro, Row, Rows, useConfirming } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { devicePublicKey, isPhone } from '@/lib/native'
import { open, useOpen } from '@/lib/router'
import { toastError } from '@/lib/toast'

export function DevicesSettings() {
  return <>
    <DeviceList />
    {useOpen() === 'add-phone' && <AddPhone />}
  </>
}

function DeviceList() {
  const devices = useDevices()
  const mine = useQuery({ queryKey: ['device-key'], queryFn: devicePublicKey, enabled: isPhone(), staleTime: Infinity }).data
  return <>
    <Intro>Chat with your agents</Intro>
    <Rows>
      {devices.data?.filter((device) => !device.self).map((device) => <DeviceRow key={device.key} device={device} mine={device.key === mine} />)}
      {!isPhone() && <Row onClick={() => open('add-phone')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-green" />} title="Add a phone" note={`Scan a code with the OpenHut app. Works when this ${HERE} is asleep too.`}><Chevron /></Row>}
      {!isPhone() && <CloudDevices />}
    </Rows>
    <ErrorNote message={devices.error?.message} />
  </>
}

function DeviceRow({ device, mine }: { device: Device; mine: boolean }) {
  const remove = useRemoveDevice()
  const { confirming, setConfirming, box } = useConfirming()
  return <div ref={box}><Row icon={<I icon={/phone/i.test(device.name) ? SmartPhone01Icon : LaptopIcon} size={20} className="text-hue-green" />} title={device.name} note={confirming ? 'It stops reaching your agents right away.' : `${mine ? 'This phone' : 'Reaches the agents on all your computers'} · added ${added(device)}`}>
    {isPhone() ? null : confirming
      ? <>
        <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(false)}>Cancel</Button>
        <Button type="button" variant="destructive" className={PILL} disabled={remove.isPending} onClick={() => remove.mutate(device.key, { onError: toastError })}>Remove</Button>
      </>
      : <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(true)}>Remove</Button>}
  </Row></div>
}

function AddPhone() {
  return <PairDialog
    title="Add a phone"
    check={() => `Allow it only if your phone shows the same numbers. It will see and talk to the agents on all your computers, like this ${HERE} does.`}
    waiting={(code) => <div className="flex items-start gap-6">
      <span className="grid size-[216px] shrink-0 place-items-center rounded-xl border border-hair bg-white p-2 [&_canvas]:size-full!"><QrCode text={code} label="Code to add a phone" /></span>
      <div className="flex min-h-[216px] flex-col gap-3 pt-1">
        <span className="text-[14px] font-medium">Scan with the OpenHut app</span>
        <ol className="m-0 flex flex-col gap-2 pl-4 text-body">
          <li>Install OpenHut on your phone.</li>
          <li>Open it and point the camera at this code.</li>
          <li>Check both screens show the same six numbers.</li>
        </ol>
        <div className="mt-auto"><Waiting>Waiting for your phone…</Waiting></div>
      </div>
    </div>}
  />
}

function added(device: Device) {
  return shortDate.format(new Date(device.addedAt))
}
