import { spawnSync } from 'node:child_process'
import { hostname } from 'node:os'
import { config } from '../platform/config.ts'
import './key-store.ts'

export { accountDevice, keysService, openLetter, ownOf, readSecret, rotateKeys, sealTo, secretOf, type Box, type Sent } from '@openhut/common/keyring/keys.ts'

export function deviceOs(): string {
  if (process.platform !== 'darwin') return process.platform === 'win32' ? 'Windows' : 'Linux'
  const version = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim().split('.')[0]
  return version ? `macOS ${version}` : 'macOS'
}

export function deviceName(): string {
  const name = process.platform === 'darwin' ? spawnSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).stdout : ''
  return (config.name || name || hostname()).trim().slice(0, 64)
}
