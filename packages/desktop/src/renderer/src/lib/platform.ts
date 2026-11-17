export type Words = { here: string; thisComputer: string; keychain: string; showFolder: string; dockBadge: boolean }

export function wordsFor(platform: string): Words {
  if (platform === 'darwin') return { here: 'Mac', thisComputer: 'This Mac', keychain: 'macOS Keychain', showFolder: 'Show in Finder', dockBadge: true }
  return { here: 'computer', thisComputer: 'This computer', keychain: 'system keyring', showFolder: 'Open folder', dockBadge: false }
}

const bridge: { platform?: string } | undefined = typeof window === 'undefined' ? undefined : Reflect.get(window, 'openhut')
const guess = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? 'darwin' : 'linux'

export const WORDS = wordsFor(bridge?.platform ?? guess)
