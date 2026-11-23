const KEY = 'openhut.asked'
const FRESH_MS = 120_000

const lines = new Map<string, { line: string; at: number }>()

export function askOf(search: string): { agentId?: string; url?: string; name?: string; auth?: string } {
  const params = new URLSearchParams(search)
  return { agentId: params.get('for') ?? undefined, url: params.get('url') ?? undefined, name: params.get('name') ?? undefined, auth: params.get('auth') ?? undefined }
}

export const asked = {
  remember({ agentId, kind }: { agentId: string; kind: string }): void {
    try { sessionStorage.setItem(KEY, `${kind}:${agentId}`) } catch { return }
  },
  forget(): void {
    try { sessionStorage.removeItem(KEY) } catch { return }
  },
  by(kind: string): string | undefined {
    try {
      const [stored, agentId] = (sessionStorage.getItem(KEY) ?? '').split(':')
      return stored === kind && agentId ? agentId : undefined
    } catch {
      return undefined
    }
  },
  done({ agentId, line }: { agentId: string; line: string }): void {
    asked.forget()
    lines.set(agentId, { line, at: Date.now() })
  },
  said(agentId: string): string | undefined {
    const waiting = lines.get(agentId)
    if (waiting && Date.now() - waiting.at > FRESH_MS) lines.delete(agentId)
    return lines.get(agentId)?.line
  },
  sent(agentId: string): void {
    lines.delete(agentId)
  },
}
