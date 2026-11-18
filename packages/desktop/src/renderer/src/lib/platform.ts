export type Words = { here: string; thisComputer: string; keychain: string; showFolder: string; badgeNote: string | undefined }

export function wordsFor(platform: string): Words {
  if (platform === 'darwin') return { here: 'Mac', thisComputer: 'This Mac', keychain: 'macOS Keychain', showFolder: 'Show in Finder', badgeNote: 'The Dock icon counts them either way.' }
  return { here: 'computer', thisComputer: 'This computer', keychain: 'system keyring', showFolder: 'Open folder', badgeNote: undefined }
}

const bridge: { platform?: string } | undefined = typeof window === 'undefined' ? undefined : Reflect.get(window, 'openhut')
const guess = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? 'darwin' : 'linux'

export const WORDS = wordsFor(bridge?.platform ?? guess)
