import { AppleIcon, LaptopIcon, ServerStack01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'
import { Flag } from '@/components/custom/flag'

export type Device = { kind: 'mac' | 'iphone' | 'server'; name: string; country?: string; city?: string; os?: string; when?: string }

const ICONS = { mac: LaptopIcon, iphone: SmartPhone01Icon, server: ServerStack01Icon }

export function DeviceIcon({ kind, size = 20 }: { kind: Device['kind']; size?: number }) {
  return <I icon={ICONS[kind]} size={size} className="shrink-0 text-mute" />
}

export function DeviceMeta({ device, named }: { device: Device; named?: boolean }) {
  const parts = [
    named && <span key="name">{device.name}</span>,
    device.city && <span key="place" className="inline-flex items-center gap-1">{device.country && <Flag country={device.country} />}{device.city}</span>,
    device.os && <span key="os" className="inline-flex items-center gap-1">{device.kind !== 'server' && <I icon={AppleIcon} size={12} />}{device.os}</span>,
    device.when && <span key="when">{device.when}</span>,
  ].filter(Boolean)
  return <span className="inline-flex items-center gap-1.5">{parts.flatMap((part, index) => index ? [<span key={index} aria-hidden>·</span>, part] : [part])}</span>
}
