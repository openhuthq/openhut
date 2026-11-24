import { desktop } from './desktop.ts'

export type Words = { here: string; thisComputer: string; keychain: string; showFolder: string; badgeNote: string | undefined }

export function wordsFor(platform: string): Words {
  if (platform === 'darwin') return { here: 'Mac', thisComputer: 'This Mac', keychain: 'macOS Keychain', showFolder: 'Show in Finder', badgeNote: 'The Dock icon counts them either way.' }
  if (platform === 'win32') return { here: 'computer', thisComputer: 'This computer', keychain: 'Windows credential store', showFolder: 'Show in Explorer', badgeNote: undefined }
  return { here: 'computer', thisComputer: 'This computer', keychain: 'system keyring', showFolder: 'Open folder', badgeNote: undefined }
}

const FROM_PHONE: Record<string, string> = { 'This Mac': 'Your Mac', 'This computer': 'Your computer' }

export function fromPhone(name: string): string {
  return FROM_PHONE[name] ?? name
}

const guess = typeof navigator !== 'undefined' && /Mac|Android/.test(navigator.userAgent) ? 'darwin' : 'linux'

export const WORDS = wordsFor(desktop?.platform ?? guess)
export const OWN_TITLE_BAR = (desktop?.platform ?? guess) === 'darwin'
