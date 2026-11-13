import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { db, migrate } from '../../src/platform/db.ts'
import { teamService } from '../../src/team/team-service.ts'

await migrate()
const { person: owner } = await teamService.createPerson({ setupCode: 'test-setup-code', username: 'owner', password: 'owner-password-1', origin: 'http://jb.test' })
const actor = { id: owner.id, username: owner.username, role: owner.role }
const tokenOf = (link: string | undefined) => (link ?? '').split('/invite/')[1]
const join = async ({ link, username }: { link: string | undefined; username: string }) =>
  (await teamService.createPerson({ inviteToken: tokenOf(link), username, password: `${username}-password-12`, origin: '' })).person

test('an invite stores only the hash of its token', async () => {
  const invite = await teamService.createInvite({ actor, role: 'member' })
  const row = await db.selectFrom('invite').selectAll().where('id', '=', invite.id).executeTakeFirstOrThrow()
  assert.equal(row.hash, createHash('sha256').update(tokenOf(invite.link)).digest('hex'))
  assert.ok(!JSON.stringify(row).includes(tokenOf(invite.link)))
})

test('an expired invite is refused', async () => {
  const invite = await teamService.createInvite({ actor, role: 'member' })
  await db.updateTable('invite').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', invite.id).execute()
  await assert.rejects(teamService.inviteLink({ token: tokenOf(invite.link) }), { status: 410 })
  await assert.rejects(join({ link: invite.link, username: 'late' }), { status: 410 })
})

test('an admin invite makes an admin, who can invite in turn', async () => {
  const admin = await join({ link: (await teamService.createInvite({ actor, role: 'admin' })).link, username: 'sara' })
  assert.equal(admin.role, 'admin')
  const next = await teamService.createInvite({ actor: { id: admin.id, username: admin.username, role: admin.role }, role: 'member' })
  assert.match(next.link ?? '', /\/invite\/jbi_[\w-]{20,}$/)
})

test('a taken username leaves the invite unused', async () => {
  const invite = await teamService.createInvite({ actor, role: 'member' })
  await assert.rejects(join({ link: invite.link, username: 'owner' }), { status: 409 })
  assert.equal((await teamService.inviteLink({ token: tokenOf(invite.link) })).role, 'member')
})

test('two people racing for one invite: exactly one gets in', async () => {
  const invite = await teamService.createInvite({ actor, role: 'member' })
  const tries = await Promise.allSettled(['ann', 'bob'].map((username) => join({ link: invite.link, username })))
  assert.equal(tries.filter((attempt) => attempt.status === 'fulfilled').length, 1)
})

test('the owner can\'t be removed; a removed person can\'t sign in', async () => {
  await assert.rejects(teamService.deletePerson({ actor, id: owner.id }), { status: 403 })
  const mia = await join({ link: (await teamService.createInvite({ actor, role: 'member' })).link, username: 'mia' })
  await teamService.deletePerson({ actor, id: mia.id })
  await assert.rejects(teamService.createSession({ username: 'mia', password: 'mia-password-12' }), { status: 401 })
})
