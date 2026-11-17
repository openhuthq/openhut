import type { TrackEvent } from '@openhut/common/telemetry.ts'

export function track(event: TrackEvent): void {
  void fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), keepalive: true }).catch(() => undefined)
}
