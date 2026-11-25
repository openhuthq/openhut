import { BrowserIcon, LaptopIcon, ServerStack01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'

export type { Computer } from '@openhut/common/computers/computer.ts'
export type Features = { whatsapp: boolean; browser: boolean }

export const DEVICE_ICONS = { mac: LaptopIcon, iphone: SmartPhone01Icon, server: ServerStack01Icon, browser: BrowserIcon }
export const DEVICE_HUE = 'text-hue-blue'
