export const SIGN_IN_MS = 15 * 60_000

export type SignIns = Record<string, number>

export function withSignIn({ pending, state, now }: { pending: SignIns; state: string; now: number }): SignIns {
  return { ...Object.fromEntries(Object.entries(pending).filter(([, at]) => now - at < SIGN_IN_MS)), [state]: now }
}

export function takeSignIn({ pending, state, now }: { pending: SignIns; state: string; now: number }): { started: boolean; rest: SignIns } {
  const at = pending[state]
  return { started: at !== undefined && now - at < SIGN_IN_MS, rest: Object.fromEntries(Object.entries(pending).filter(([key, when]) => key !== state && now - when < SIGN_IN_MS)) }
}

export function hinted({ url, loginHint }: { url: string; loginHint?: string }): string {
  if (!loginHint) return url
  const out = new URL(url)
  out.searchParams.set('login_hint', loginHint)
  return out.toString()
}
