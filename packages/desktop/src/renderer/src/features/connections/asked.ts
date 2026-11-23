const KEY = 'openhut.asked'

export type Asked = { agentId: string; kind: string }

export const said = new Map<string, string>()

export function askOf(search: string): { agentId?: string; url?: string; name?: string; auth?: string } {
  const params = new URLSearchParams(search)
  return { agentId: params.get('for') ?? undefined, url: params.get('url') ?? undefined, name: params.get('name') ?? undefined, auth: params.get('auth') ?? undefined }
}

export const asked = {
  remember(value: Asked): void {
    try { sessionStorage.setItem(KEY, JSON.stringify(value)) } catch { return }
  },
  by(kind: string): string | undefined {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
      return isAsked(value) && value.kind === kind ? value.agentId : undefined
    } catch {
      return undefined
    }
  },
  done({ agentId, line }: { agentId: string; line: string }): void {
    try { sessionStorage.removeItem(KEY) } catch { return }
    finally { said.set(agentId, line) }
  },
}

function isAsked(value: unknown): value is Asked {
  return typeof value === 'object' && value !== null && 'agentId' in value && 'kind' in value && typeof value.agentId === 'string' && typeof value.kind === 'string'
}
