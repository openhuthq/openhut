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

// Outside the desktop shell the browser's own OS says nothing about the computer it talks to.
export const WORDS = wordsFor(desktop?.platform ?? '')
// A browser tab has its own title bar and no traffic lights.
export const OWN_TITLE_BAR = desktop?.platform === 'darwin'
