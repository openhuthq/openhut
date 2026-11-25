import { BrowserIcon, LaptopIcon, ServerStack01Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'

export type Features = { whatsapp: boolean; browser: boolean }
export type Computer = { id: string; name: string; version: string | null; online: boolean; features: Features }

export const DEVICE_ICONS = { mac: LaptopIcon, iphone: SmartPhone01Icon, server: ServerStack01Icon, browser: BrowserIcon }
export const DEVICE_HUE = 'text-hue-blue'
