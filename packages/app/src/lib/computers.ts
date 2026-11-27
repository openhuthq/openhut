import { BrowserIcon, LaptopIcon, ServerStack01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'

import type { Computer } from '@openhut/common/computers/computer.ts'

export type { Computer }
export type Features = { whatsapp: boolean; browser: boolean }

export const DEVICE_ICONS = { mac: LaptopIcon, iphone: SmartPhone01Icon, server: ServerStack01Icon, browser: BrowserIcon }
export const DEVICE_HUE = 'text-hue-blue'

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
