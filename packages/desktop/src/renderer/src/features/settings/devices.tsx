import { LaptopIcon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import type { Device } from '@openhut/client'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { useDevices, useRemoveDevice } from '@/features/settings/api'
import { Intro, Row, Rows, useConfirming } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { WORDS } from '@/lib/platform'
import { toastError } from '@/lib/toast'

export function DevicesSettings() {
  const devices = useDevices()
  return <>
    <Intro>These can reach the agents on all your computers.</Intro>
    <Rows>
      {devices.data?.map((device) => device.self
        ? <Row key={device.key} icon={<I icon={LaptopIcon} size={20} className="text-hue-blue" />} title={WORDS.thisComputer} note={`The OpenHut app · added ${added(device)}`} />
        : <DeviceRow key={device.key} device={device} />)}
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

function added(device: Device) {
  return shortDate.format(new Date(device.addedAt))
}
