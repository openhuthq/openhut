import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { bootCloud, hasCloud, webBrowser } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: a browser on an account with no computer makes a join code, the server that runs it becomes the first computer, and it lets that browser in when it knocks', { skip }, async () => {
  const cloud = await bootCloud()
  const { client } = await webBrowser({ url: cloud.url, email: 'sara@example.com' })
  const me = async () => {
    const found = await client.me()
    assert.ok(found)
    return found
  }
  assert.deepEqual((await me()).workspaces, [])
  const join = await client.firstComputerCode()
  process.env.OPENHUT_JOIN = join.code

  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  await migrate()
  try {
    cloudService.connect()
    for (let i = 0; i < 100 && !keysService.account(); i++) await sleep(50)
    assert.equal(keysService.account()?.email, 'sara@example.com')
    const home = (await me()).home ?? ''
    assert.deepEqual((await me()).workspaces.map((each) => [each.id, each.access]), [[home, 'waiting']])

    const knock = client.knock({ team: home, nonce: 'n'.repeat(43) })
    await knock.ask({ name: 'Chrome (web)', os: 'web' })
    for (let i = 0; i < 100 && !(await knock.mine())?.reviewed; i++) await sleep(100)
    assert.equal(await knock.reveal(), true)
    for (let i = 0; i < 100 && (await knock.state()).step !== 'approved'; i++) await sleep(100)
    assert.equal((await me()).workspaces[0]?.access, 'listed')
  } finally {
    cloudEvents.stop()
    await cloud.close()
  }
})
