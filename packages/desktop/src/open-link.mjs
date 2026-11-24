const ASKED = /^#\/connections\/new\/[a-z_]+\?[^#]*$/

export function linkPath(url) {
  try {
    const { protocol, hostname, hash } = new URL(url ?? '')
    if (protocol !== 'openhut:' || hash.length < 2) return undefined
    if (hostname === 'join') return `/join${hash}`
    return hostname === 'open' && ASKED.test(hash) && !new URLSearchParams(hash.split('?')[1]).has('error') ? hash.slice(1) : undefined
  } catch {
    return undefined
  }
}

export function signInCallback(url) {
  try {
    const { protocol, hostname, searchParams } = new URL(url ?? '')
    if (protocol !== 'openhut:' || hostname !== 'signed-in' || !searchParams.get('state')) return undefined
    const kept = new URLSearchParams([...searchParams].filter(([name]) => ['state', 'code', 'error'].includes(name)))
    return `/api/cloud/callback?${kept}`
  } catch {
    return undefined
  }
}
