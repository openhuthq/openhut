export type Peer = { name: string; dns: string; os: string; ip: string; online: boolean; ssh: boolean }
export type PeerState = 'ready' | 'ssh-off' | 'offline' | 'phone' | 'not-linux'

const PHONES = new Set(['iOS', 'android', 'tvOS'])
const ORDER: PeerState[] = ['ready', 'ssh-off', 'not-linux', 'offline', 'phone']

export function stateOf(peer: Peer): PeerState {
  if (PHONES.has(peer.os)) return 'phone'
  if (!peer.online) return 'offline'
  if (peer.os !== 'linux') return 'not-linux'
  return peer.ssh ? 'ready' : 'ssh-off'
}

export function byEligibility(peers: Peer[]): Peer[] {
  return [...peers].sort((a, b) => ORDER.indexOf(stateOf(a)) - ORDER.indexOf(stateOf(b)) || a.name.localeCompare(b.name))
}
