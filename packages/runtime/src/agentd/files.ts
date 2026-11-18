import { closeSync, constants, existsSync, fchownSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs'
import { openedPath, openInside } from './skills.ts'

export const MAX_FILE_BYTES = 25 << 20
export const MAX_FILE_BASE64 = Math.ceil(MAX_FILE_BYTES / 3) * 4
const UPLOADS = 'uploads'
const NAME = /^[\p{L}\p{N}_(+,=@][\p{L}\p{N}._ ()+,=@-]{0,119}$/u
const MAX_DEPTH = 32
const MAX_COPIES = 100

type Owner = { uid: number; gid: number }

export function isUploadName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value)
}

export function isHomePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024) return false
  const segments = value.split('/')
  return segments.length <= MAX_DEPTH && segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('\0'))
}

export function saveUpload({ home, name, body, owner }: { home: string; name: string; body: Buffer; owner?: Owner }): string {
  const homeFd = openDir(home)
  try {
    try {
      mkdirSync(`${via({ fd: homeFd, path: home })}/${UPLOADS}`, { mode: 0o700 })
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e
    }
  } finally {
    closeSync(homeFd)
  }
  const dir = `${home}/${UPLOADS}`
  const dirFd = openDir(dir)
  try {
    if (owner) fchownSync(dirFd, owner.uid, owner.gid)
    for (let copy = 1; copy <= MAX_COPIES; copy++) {
      const saved = copy === 1 ? name : numbered({ name, copy })
      const fd = createQuietly(`${via({ fd: dirFd, path: dir })}/${saved}`)
      if (fd === undefined) continue
      try {
        writeFileSync(fd, body)
        if (owner) fchownSync(fd, owner.uid, owner.gid)
      } finally {
        closeSync(fd)
      }
      return `${UPLOADS}/${saved}`
    }
    throw new Error(`there are already ${MAX_COPIES} files called ${name}`)
  } finally {
    closeSync(dirFd)
  }
}

export function readHomeFile({ home, path }: { home: string; path: string }): Buffer {
  const fd = openInside({ root: home, file: path, flags: constants.O_RDONLY })
  if (fd === undefined) throw new Error('that file isn\'t in the agent\'s home folder')
  try {
    const { size } = fstatSync(fd)
    if (size > MAX_FILE_BYTES) throw new Error(`that file is over ${MAX_FILE_BYTES >> 20} MB`)
    const buffer = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const got = readSync(fd, buffer, read, size - read, read)
      if (!got) break
      read += got
    }
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

function openDir(path: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  if (openedPath({ fd, path, ino: fstatSync(fd).ino }) === path) return fd
  closeSync(fd)
  throw new Error('the agent\'s home folder isn\'t where it should be')
}

function via({ fd, path }: { fd: number; path: string }): string {
  return existsSync('/proc/self/fd') ? `/proc/self/fd/${fd}` : path
}

function createQuietly(path: string): number | undefined {
  try {
    return openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644)
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'EEXIST') return undefined
    throw e
  }
}

function numbered({ name, copy }: { name: string; copy: number }): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}-${copy}${name.slice(dot)}` : `${name}-${copy}`
}
