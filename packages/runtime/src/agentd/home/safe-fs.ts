import { closeSync, constants, existsSync, fstatSync, openSync, readlinkSync, readSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export function readInside({ root, file, limit }: { root: string; file: string; limit: number }): string | undefined {
  const fd = openInside({ root, file, flags: constants.O_RDONLY })
  if (fd === undefined) return undefined
  try {
    const buffer = Buffer.alloc(limit)
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, limit, 0))
  } finally {
    closeSync(fd)
  }
}

export function openInside({ root, file, flags }: { root: string; file: string; flags: number }): number | undefined {
  const fd = openQuietly(`${root}/${file}`, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  if (fd === undefined) return undefined
  const stat = fstatSync(fd)
  if (stat.isFile() && stat.nlink === 1 && openedPath({ fd, path: `${root}/${file}`, ino: stat.ino }) === resolve(root, file)) return fd
  closeSync(fd)
  return undefined
}

function openedPath({ fd, path, ino }: { fd: number; path: string; ino: number }): string | undefined {
  if (existsSync('/proc/self/fd')) return readlinkSync(`/proc/self/fd/${fd}`)
  const real = realpathSync(path)
  return statSync(real).ino === ino ? real : undefined
}

function openQuietly(path: string, flags: number): number | undefined {
  try {
    return openSync(path, flags)
  } catch {
    return undefined
  }
}
