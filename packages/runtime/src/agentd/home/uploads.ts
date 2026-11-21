import { randomBytes } from 'node:crypto'
import { closeSync, constants, existsSync, fchownSync, fstatSync, lstatSync, mkdirSync, openSync, readlinkSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openInside } from './skills.ts'

export const MAX_FILE_BYTES = 25 << 20
export const MAX_FILE_BASE64 = Math.ceil(MAX_FILE_BYTES / 3) * 4
export const MAX_NAME_BYTES = 255
const UPLOADS = 'uploads'
const NAME = /^[\p{L}\p{N}_(+,=@][\p{L}\p{N}._ ()+,=@-]{0,127}$/u
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
  const names = Array.from({ length: MAX_COPIES }, (_, i) => i === 0 ? name : numbered({ name, copy: i + 1 }))
  const saved = saveNew({ root: home, dir: UPLOADS, names, body, owner })
  if (!saved) throw new Error(`there are already ${MAX_COPIES} files called ${name}`)
  return `${UPLOADS}/${saved}`
}

export function replaceUpload({ home, name, body, owner, trash }: { home: string; name: string; body: Buffer; owner?: Owner; trash: string }): string {
  const part = `.openhut-${randomBytes(8).toString('hex')}.part`
  if (!saveNew({ root: home, dir: UPLOADS, names: [part], body, owner })) throw new Error('the new copy could not be written')
  within({ dir: home, expected: home, work: (here) => within({ dir: `${here}${UPLOADS}`, expected: `${home}/${UPLOADS}`, work: (uploads) => {
    try {
      lstatSync(`${uploads}${name}`)
      mkdirSync(trash, { recursive: true, mode: 0o700 })
      renameSync(`${uploads}${name}`, `${trash}/${name}`)
    } catch (e) {
      if (!isCode(e, 'ENOENT')) throw e
    }
    renameSync(`${uploads}${part}`, `${uploads}${name}`)
  } }) })
  return `${UPLOADS}/${name}`
}

export function saveNew({ root, dir, names, body, owner }: { root: string; dir: string; names: string[]; body: Buffer; owner?: Owner }): string | undefined {
  return within({ dir: root, expected: root, work: (here) => {
    try {
      mkdirSync(`${here}${dir}`, { mode: 0o700 })
    } catch (e) {
      if (!isCode(e, 'EEXIST')) throw e
    }
    return within({ dir: `${here}${dir}`, expected: `${root}/${dir}`, work: (inside) => {
      if (owner) chownDir({ dir: inside, owner })
      for (const name of names) {
        const fd = createQuietly(`${inside}${name}`)
        if (fd === undefined) continue
        try {
          writeFileSync(fd, body)
          if (owner) fchownSync(fd, owner.uid, owner.gid)
        } finally {
          closeSync(fd)
        }
        return name
      }
      return undefined
    } })
  } })
}

export function removeUploads({ home, names }: { home: string; names: string[] }): string[] {
  try {
    return within({ dir: home, expected: home, work: (here) => within({ dir: `${here}${UPLOADS}`, expected: `${home}/${UPLOADS}`, work: (uploads) => names.filter((name) => {
      try {
        if (!lstatSync(`${uploads}${name}`).isFile()) return false
        unlinkSync(`${uploads}${name}`)
        return true
      } catch {
        return false
      }
    }) }) })
  } catch (e) {
    if (isCode(e, 'ENOENT')) return []
    throw e
  }
}

export function statHomeFiles({ home, paths }: { home: string; paths: string[] }): { path: string; size: number }[] {
  return paths.flatMap((path) => {
    const fd = openInside({ root: home, file: path, flags: constants.O_RDONLY })
    if (fd === undefined) return []
    try {
      return [{ path, size: fstatSync(fd).size }]
    } finally {
      closeSync(fd)
    }
  })
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
    if (process.cwd() !== resolve(expected)) throw moved()
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
