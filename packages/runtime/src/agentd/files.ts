import { closeSync, constants, existsSync, fchownSync, fstatSync, mkdirSync, openSync, readlinkSync, readSync, writeFileSync } from 'node:fs'
import { openInside } from './skills.ts'

export const MAX_FILE_BYTES = 25 << 20
export const MAX_FILE_BASE64 = Math.ceil(MAX_FILE_BYTES / 3) * 4
export const MAX_NAME_BYTES = 255
const UPLOADS = 'uploads'
const NAME = /^[\p{L}\p{N}_(+,=@][\p{L}\p{N}._ ()+,=@-]{0,119}$/u
const MAX_DEPTH = 32
const MAX_COPIES = 100
const PROC = existsSync('/proc/self/fd')

type Owner = { uid: number; gid: number }

export function isUploadName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value) && Buffer.byteLength(value) <= MAX_NAME_BYTES
}

export function isHomePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024) return false
  const segments = value.split('/')
  return segments.length <= MAX_DEPTH && segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('\0'))
}

export function saveUpload({ home, name, body, owner }: { home: string; name: string; body: Buffer; owner?: Owner }): string {
  return within({ dir: home, expected: home, work: (here) => {
    try {
      mkdirSync(`${here}${UPLOADS}`, { mode: 0o700 })
    } catch (e) {
      if (!isCode(e, 'EEXIST')) throw e
    }
    return within({ dir: `${here}${UPLOADS}`, expected: `${home}/${UPLOADS}`, work: (uploads) => {
      if (owner) chownDir({ dir: uploads, owner })
      for (let copy = 1; copy <= MAX_COPIES; copy++) {
        const saved = copy === 1 ? name : numbered({ name, copy })
        const fd = createQuietly(`${uploads}${saved}`)
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
    } })
  } })
}

export function readHomeFile({ home, path }: { home: string; path: string }): Buffer | undefined {
  const fd = openInside({ root: home, file: path, flags: constants.O_RDONLY })
  if (fd === undefined) return undefined
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

function within<T>({ dir, expected, work }: { dir: string; expected: string; work: (here: string) => T }): T {
  if (!PROC) return withCwd({ dir, expected, work })
  const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    if (readlinkSync(`/proc/self/fd/${fd}`) !== expected) throw moved()
    return work(`/proc/self/fd/${fd}/`)
  } finally {
    closeSync(fd)
  }
}

function withCwd<T>({ dir, expected, work }: { dir: string; expected: string; work: (here: string) => T }): T {
  const before = process.cwd()
  try {
    process.chdir(dir)
    if (process.cwd() !== expected) throw moved()
    return work('./')
  } finally {
    try {
      process.chdir(before)
    } catch {
      process.chdir('/')
    }
  }
}

function moved(): Error {
  return new Error('the agent\'s home folder isn\'t where it should be')
}

function chownDir({ dir, owner }: { dir: string; owner: Owner }): void {
  const fd = openSync(`${dir}.`, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    fchownSync(fd, owner.uid, owner.gid)
  } finally {
    closeSync(fd)
  }
}

function createQuietly(name: string): number | undefined {
  try {
    return openSync(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644)
  } catch (e) {
    if (isCode(e, 'EEXIST')) return undefined
    throw e
  }
}

function numbered({ name, copy }: { name: string; copy: number }): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  const stem = Array.from(dot > 0 ? name.slice(0, dot) : name)
  while (stem.length > 1 && Buffer.byteLength(`${stem.join('')}-${copy}${ext}`) > MAX_NAME_BYTES) stem.pop()
  return `${stem.join('')}-${copy}${ext}`
}

function isCode(e: unknown, code: string): boolean {
  return e instanceof Error && 'code' in e && e.code === code
}
