import { fileInHome } from '@openhut/common/threads/thread.ts'

const FENCE = /^\s{0,3}(```|~~~)/
const ROW = /^\s{0,3}\|/
const DELIMITER = /^\s{0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

export function settled(text: string): string {
  const lines = text.split('\n')
  if (lines.filter((line) => FENCE.test(line)).length % 2 === 1) return text
  const done = lines.slice(0, -1)
  let start = done.length
  while (start > 0 && ROW.test(done[start - 1] ?? '')) start--
  const rows = done.slice(start)
  const headed = rows.length >= 2 && DELIMITER.test(rows[1] ?? '')
  if (rows.length > 0 && !headed) return lines.slice(0, start).join('\n')
  if (rows.length === 0 && ROW.test(lines.at(-1) ?? '')) return done.join('\n')
  return text
}

export function bullets(text: string): string {
  let fenced = false
  return text.split('\n').map((line) => {
    if (FENCE.test(line)) fenced = !fenced
    return fenced ? line : line.replace(/^(\s*)• /, '$1- ')
  }).join('\n')
}

export function media(text: string): string {
  return text.replace(/^[ \t]*MEDIA:[ \t]*(\S+)[ \t]*$/gm, (line, path: string) => /\.[A-Za-z0-9]{1,10}$/.test(path) && fileInHome(path) !== undefined ? `![](${path})` : line)
}
