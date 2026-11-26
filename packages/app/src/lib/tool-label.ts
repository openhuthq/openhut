const VERBS: Record<string, [string, string]> = {
  list: ['Listed', 'list'], get: ['Read', 'read'], read: ['Read', 'read'], query: ['Checked', 'check'], create: ['Created', 'create'], save: ['Saved', 'save'],
  update: ['Changed', 'change'], edit: ['Changed', 'change'], delete: ['Deleted', 'delete'], remove: ['Removed', 'remove'], push: ['Pushed', 'push'],
  search: ['Searched', 'search'], resize: ['Resized', 'resize'], manage: ['Updated', 'update'], send: ['Sent', 'send'], run: ['Ran', 'run'], open: ['Opened', 'open'],
}
const WORDS: Record<string, string> = { db: 'database', psql: '', cluster: '', config: 'settings', insights: 'metrics', rule: '', notification: 'alert', issue: 'ticket', pr: 'pull request', git: '', via: '', gateway: '', mcp: '', openhut: '', call: '', tool: '' }
const ARTICLE = new Set(['create', 'delete', 'save', 'remove'])

export function toolLabel(name: string, tense: 'past' | 'now' = 'past'): string {
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name)) return tense === 'past' ? `Opened ${name}` : `open ${name}`
  const words = (name.split('__').at(-1) ?? name).split(/[\s._-]+/).filter(Boolean).map((word) => word.toLowerCase())
  const at = words.findIndex((word) => Object.hasOwn(VERBS, word))
  const nouns = words.filter((_, index) => index !== at).map((word) => WORDS[word] ?? word).filter(Boolean)
  if (at < 0) return tense === 'past' ? capital(nouns.join(' ') || name) : `use ${nouns.join(' ') || name}`
  const [past, now] = VERBS[words[at]]
  const verb = tense === 'past' ? past : now
  const object = nouns.slice(-2)
  if (now === 'list' && object.length && !object.at(-1)?.endsWith('s')) object[object.length - 1] += 's'
  if (!object.length) return verb
  const phrase = object.join(' ')
  return ARTICLE.has(words[at]) && !phrase.endsWith('s') ? `${verb} ${/^[aeiou]/.test(phrase) ? 'an' : 'a'} ${phrase}` : `${verb} ${phrase}`
}

export function plainKey(key: string): string {
  return capital((key.split('.').at(-1) ?? key).replace(/[_-]+/g, ' ').replace(/^max (.+?)s?$/, '$1 limit'))
}

export function toolSentence(name: string): string {
  const label = toolLabel(name)
  return Object.values(VERBS).some(([past]) => label.startsWith(`${past} `) || label === past) ? label : `Used ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
