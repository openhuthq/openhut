import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listedChannels } from '../../../../src/features/agents/channels/channel-kinds.ts'

test('Channels lists only the channels that are set up, in the usual order', () => {
  const channel = (kind: string, status: string) => ({ id: kind, kind, status }) as never
  assert.deepEqual(listedChannels([]), [])
  assert.deepEqual(listedChannels([channel('telegram', 'linking'), channel('slack', 'connected')]).map((each: { kind: string }) => each.kind), ['slack', 'telegram'])
})
