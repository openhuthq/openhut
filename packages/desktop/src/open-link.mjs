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
