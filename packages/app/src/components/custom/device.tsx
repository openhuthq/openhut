import { AppleIcon } from '@hugeicons/core-free-icons'
export { DEVICE_HUE, DEVICE_ICONS } from '@/lib/computers'
import { I } from '@/components/kit'
import { Flag } from '@/components/custom/flag'

export type Device = { kind: 'mac' | 'iphone' | 'server' | 'browser'; name: string; country?: string; city?: string; os?: string; when?: string }

export function DeviceMeta({ device, named }: { device: Device; named?: boolean }) {
  const parts = [
    named && <span key="name">{device.name}</span>,
    device.city && <span key="place" className="inline-flex items-center gap-1">{device.country && <Flag country={device.country} />}{device.city}</span>,
    device.os && <span key="os" className="inline-flex items-center gap-1">{device.os.startsWith('macOS') && <I icon={AppleIcon} size={12} />}{device.os}</span>,
    device.when && <span key="when">{device.when}</span>,
  ].filter(Boolean)
  return <span className="inline-flex items-center gap-1.5">{parts.flatMap((part, index) => index ? [<span key={index} aria-hidden>·</span>, part] : [part])}</span>
}
