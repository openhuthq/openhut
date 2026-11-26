export const MARK = '<!-- openhut -->'
export const BODY_TOOLS = ['create_pull_request', 'update_pull_request', 'issue_write', 'add_issue_comment'] as const
const LIMIT = 65_000

export function signed({ body, name, face }: { body: string; name: string; face: string | null }): string {
  const image = face ? `<img src="${face}" width="16" height="16" align="top" alt=""> ` : ''
  const footer = `${MARK}\n---\n<sub>${image}Opened by <b>${escaped(name)}</b>, an AI agent · Made with <a href="https://openhut.dev/?ref=gh">OpenHut</a></sub>`
  const text = body.split(MARK)[0].trimEnd().slice(0, LIMIT - footer.length - 2)
  return text ? `${text}\n\n${footer}` : footer
}

export type Signing = 'sign' | 'first_comment' | 'leave'

export function signingOf({ tool, args }: { tool: string; args: Record<string, unknown> }): Signing {
  const hasBody = typeof args.body === 'string'
  if (tool === 'create_pull_request') return 'sign'
  if (tool === 'update_pull_request') return hasBody ? 'sign' : 'leave'
  if (tool === 'issue_write') return args.method === 'create' || hasBody ? 'sign' : 'leave'
  if (tool === 'add_issue_comment') return 'first_comment'
  return 'leave'
}

export const threadOf = (args: Record<string, unknown>): string => `${String(args.owner)}/${String(args.repo)}#${String(args.issue_number)}`.toLowerCase()

const escaped = (text: string): string => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)
