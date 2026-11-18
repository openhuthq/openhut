import type { TrackEvent } from '@openhut/common/telemetry.ts'
import { openhut } from '@/lib/openhut'

export function track(event: TrackEvent): void {
  void openhut.fetch({ computer: 'local', path: '/api/events', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), keepalive: true } }).catch(() => undefined)
}
