import { LaptopIcon, PlusSignIcon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import type { Device } from '@openhut/client'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { QrCode } from '@/features/agents/qr-code'
import { useDevices, useRemoveDevice } from '@/features/settings/api'
import { HERE } from '@/features/settings/desktop'
import { Invite } from '@/features/settings/invite'
import { Chevron, Intro, Row, Rows, SubPage, useConfirming } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { open, useOpen } from '@/lib/router'
import { WORDS } from '@/lib/platform'
import { toastError } from '@/lib/toast'

export function DevicesSettings() {
  if (useOpen() === 'add') return <AddPhone />
  return <DeviceList />
}

function DeviceList() {
  const devices = useDevices()
  return <>
    <Intro>These can reach the agents on all your computers.</Intro>
    <Rows>
      {devices.data?.map((device) => device.self
        ? <Row key={device.key} icon={<I icon={LaptopIcon} size={20} className="text-hue-blue" />} title={WORDS.thisComputer} note={`The OpenHut app · added ${added(device)}`} />
        : <DeviceRow key={device.key} device={device} />)}
      <Row onClick={() => open('add')} icon={<I icon={PlusSignIcon} size={20} className="text-hue-green" />} title="Add a phone" note={`Scan a code with the OpenHut app. Works when this ${HERE} is asleep too.`}><Chevron /></Row>
    </Rows>
    <ErrorNote message={devices.error?.message} />
  </>
}

function DeviceRow({ device }: { device: Device }) {
  const remove = useRemoveDevice()
  const { confirming, setConfirming, box } = useConfirming()
  return <div ref={box}><Row icon={<I icon={SmartPhone01Icon} size={20} className="text-hue-green" />} title={device.name} note={confirming ? 'It stops reaching your agents right away.' : `Added ${added(device)}`}>
    {confirming
      ? <>
        <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(false)}>Cancel</Button>
        <Button type="button" variant="destructive" className={PILL} disabled={remove.isPending} onClick={() => remove.mutate(device.key, { onError: toastError })}>Remove</Button>
      </>
      : <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(true)}>Remove</Button>}
  </Row></div>
}

function AddPhone() {
  return <SubPage title="Add a phone" back="">
    <Invite
      check={() => `Allow it only if your phone shows the same numbers. It will see and talk to the agents on all your computers, like this ${HERE} does.`}
      waiting={(code) => <div className="flex items-start gap-6 px-2.5">
        <span className="grid size-[176px] shrink-0 place-items-center rounded-xl border border-hair bg-white p-2 [&_canvas]:size-full!"><QrCode text={code} label="Code to add a phone" /></span>
        <div className="flex flex-col gap-2 pt-1">
          <span className="text-[14px] font-medium">Scan with the OpenHut app</span>
          <ol className="m-0 flex flex-col gap-1.5 pl-4 text-[13px] text-body">
            <li>Install OpenHut on your phone.</li>
            <li>Open it and point the camera at this code.</li>
            <li>Check both screens show the same six numbers.</li>
          </ol>
          <span className="text-[12px] text-mute">The code works once, for 5 minutes.</span>
        </div>
      </div>}
    />
  </SubPage>
}

function added(device: Device) {
  return shortDate.format(new Date(device.addedAt))
}
