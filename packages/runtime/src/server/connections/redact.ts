const KEY = '[\\w-]*(?:password|passwd|private[_-]?key|token|secret|connection[_-]?string)[\\w-]*'
const QUOTED = new RegExp(`("${KEY}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi')
const PLAIN = new RegExp(`^(\\s*${KEY}\\s*[:=]\\s*)(?!\\s*\\[hidden\\])\\S.*$`, 'gim')
const CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:)[^\s@/"']+@/gi

export function redact(text: string): string {
  return text.replace(QUOTED, '$1"[hidden]"').replace(PLAIN, '$1[hidden]').replace(CREDENTIALS, '$1[hidden]@')
}
