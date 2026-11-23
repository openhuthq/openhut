import { randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import * as z from 'zod/mini'
import { type Backup, type CloudWorkspaceView, KeyBox, Letter, MemberList, signProof, type Role, type Cloud, type CloudAuthorization, type RecoveryKit, type UnlockCloud, siteHost } from '@openhut/common/cloud/cloud.ts'
import { addedOf, bodyOf } from '@openhut/common/cloud/member-list.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/vault.ts'
import { kitId } from '@openhut/common/vault/kit-file.ts'
import { cloud, type Box, type Letter as Sealed } from '../platform/cloud.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { callbackBase, connectionService } from '../connections/connection-service.ts'
import { keyStore, type Account, type AskRoom } from './key-store.ts'
import { deviceName, deviceOs, keysService, openLetter, sealTo } from './keys-service.ts'
import { roomKeys } from './room-keys.ts'
import { guessSite, teamIcon } from './team-icon.ts'
import { cloudEvents } from './cloud-events.ts'
import { recordsService } from './records.ts'
import { agentService } from '../agents/agent-service.ts'

const PENDING_MS = 15 * 60_000
const CHECK_MS = 60_000
const SIGNED_IN = 'You’re signed in. You can go back to OpenHut.'
const Workspaces = z.object({ data: z.array(z.object({ id: z.string(), key: z.string(), by: z.optional(z.string()), signature: z.optional(z.string()) })) })
const Newer = z.object({ data: z.array(z.unknown()) })
const IDLE: Backup = { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null }
const CHANGED = 'Someone changed this team a moment ago. Try again.'
const Lists = z.object({ data: z.array(MemberList), hasMore: z.optional(z.boolean()) })
const Letters = z.object({ data: z.array(Letter) })
const Asked = z.object({ data: z.array(z.object({ device: z.string() })) })
const ROTATE = 'cloud_rotate'
const Teams = z.object({ data: z.array(z.object({ id: z.string() })) })
const ASK_POLL_MS = 2000
const pending = new Map<string, number>()
let signInError: string | null = null
let boxesDiffer = false
let checkedAt = 0
let boxes: Promise<unknown> = Promise.resolve()
let passkeySaved = false
let asking: { settled: string[]; approved: boolean; error: string | null; timer: NodeJS.Timeout } | undefined
let polling = false
const Rotate = z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() }))

export const cloudService = {
  async status(): Promise<Cloud> {
    const account = keysService.account()
    const session = keysService.session()
    const on = Boolean(account && session)
    const members = roomKeys.members()
    const locked = !account ? keysService.locked() : undefined
    if (on && Date.now() - checkedAt > CHECK_MS) checkSoon()
    const here = await keysService.deviceKey()
    const lists = on && account ? roomKeys.rooms().map((room) => roomKeys.members(room.workspace.id)) : []
    const accountKey = await keysService.accountDeviceKey()
    const asked = locked ? resumeAsking() : undefined
    const askRooms = keysService.asked()
    const [inCloud, passkeyInCloud] = locked && session ? await Promise.all([kitInCloud(), boxInCloud('passkey')]) : [null, false]
    const devices = lists.flatMap((body) => {
      const mine = body?.members.find((member) => member.email === account?.email)
      return body && mine ? mine.devices.filter((key) => key !== mine.kit && key !== accountKey).map((key) => ({ key, here: key === here, addedAt: addedOf(body, key) ? new Date(addedOf(body, key)).toISOString() : null, name: body.names?.[key] ?? null, kind: body.runtimes?.includes(key) ? 'server' as const : 'mac' as const })) : []
    }).filter(({ key }, index, all) => all.findIndex((each) => each.key === key) === index).sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))
    return {
      object: 'cloud', status: locked ? 'locked' : on ? (cloudEvents.ready() ? 'on' : 'offline') : 'off', email: locked?.email ?? (on && account ? account.email : null),
      device: here,
      workspace: on && account && members ? { id: account.workspace.id, version: members.version, members: members.members } : null,
      keyStore: keyStore.kind(), kit: on ? kitOf() : null, kitInCloud: inCloud ? inCloud.found : Boolean(keysService.kitState().saved), cloudKit: inCloud?.kit ?? null, backup: IDLE,
      signInError, keptAccount: on ? null : (keysService.kitState().saved ? keysService.account()?.email ?? null : null), devices, passkey: on ? passkeySaved : passkeyInCloud, youngUntil: null, needsSignIn: Boolean(locked && !session),
      workspaces: on && account ? roomKeys.rooms().map(({ workspace: { id, key } }) => {
        const body = roomKeys.members(id)
        const invites = (body?.invites ?? []).map((each) => ({ email: each.email, role: each.role, link: roomKeys.link({ ws: id, email: each.email }) ?? null }))
        return { id, name: cloudEvents.name(id), website: cloudEvents.site(id), home: id === account.workspace.id, own: roomKeys.isOwn(id), role: roomKeys.roleIn(id) ?? 'member', waiting: !key, members: body?.members ?? [], invites, requests: cloudEvents.requests(id), names: body?.names ?? {} }
      }) : [],
      asking: asked ? { rooms: askRooms.filter((room) => !asked.settled.includes(room.id)).map(({ admins, own }) => ({ admins, own: Boolean(own) })), denied: asked.settled.length === askRooms.length, error: asked.error, name: deviceName() } : null,
      canAsk: Boolean(locked && session),
      rotate: on ? await toRotate() : [],
      gone: cloudEvents.gone(),
    }
  },

  async ask(): Promise<Cloud> {
    const { email } = mustBeLocked()
    await stopAsking()
    const token = await keysService.token()
    const teams = (await teamsOf(token)).map(({ id }) => id)
    const own = (await boxesOf(token)).filter((box) => !teams.includes(box.id))
    const rooms: AskRoom[] = []
    let refused: string | null = null
    for (const { id, chain } of [...own, ...await Promise.all(teams.map(async (id) => ({ id, chain: await chainOf({ workspace: id, token }) })))]) {
      const body = bodyOf(chain.at(-1))
      const me = body?.members.find((member) => member.email === email)
      const home = !teams.includes(id) && me?.role === 'owner'
      const approvers = home
        ? [me].filter((member) => member.devices.some((device) => device !== member.kit && !body?.runtimes?.includes(device)))
        : body?.members.filter((member) => member.role !== 'member' && member.email !== email) ?? []
      if (!approvers.length) continue
      const asked = await cloud.room({ method: 'POST', workspace: id, path: '/requests', token, body: { name: deviceName(), os: deviceOs(), server: config.installKind === 'server' } })
      if (asked.status !== 200) refused = z.safeParse(z.object({ error: z.object({ message: z.string() }) }), asked.json).data?.error.message ?? 'OpenHut Cloud couldn’t send your request. Try again.'
      if (asked.status !== 200) continue
      rooms.push({ id, admins: approvers.map((member) => member.email), own: home })
    }
    if (!rooms.length) throw new HttpError(409, refused ?? 'None of your other computers or team admins can let this computer in. Use your recovery kit.')
    await keysService.setAsked(rooms)
    resumeAsking()
    return cloudService.status()
  },

  async cancelAsk(): Promise<Cloud> {
    const rooms = keysService.asked()
    await stopAsking()
    const token = await keysService.token()
    const me = encodeURIComponent(await keysService.deviceKey())
    for (const { id: workspace } of rooms) await cloud.room({ method: 'DELETE', workspace, path: `/requests/${me}`, token }).catch(() => undefined)
    return cloudService.status()
  },

  async approve({ workspace, device }: { workspace: string; device: string }): Promise<Cloud> {
    const asked = cloudEvents.requests(mustBeOn(workspace)).find((each) => each.device === device)
    if (!asked) throw new HttpError(404, 'That device isn’t waiting anymore. It was let in, denied, or it expired.')
    const mine = roomKeys.isOwn(workspace) && asked.email === keysService.account()?.email
    if (mine && !asked.server) {
      const sent = await cloud.room({ method: 'POST', workspace, path: '/letters', token: await keysService.token(), body: await keysService.accountLetter(device) })
      if (sent.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t let that computer in. Try again.')
      return cloudService.status()
    }
    const approved = mine ? await serverApproval({ device, name: asked.name }) : await roomKeys.approve({ ws: workspace, email: asked.email, device, name: asked.name })
    await putList({ workspace, list: approved.list, letters: [approved.letter] })
    await cloudEvents.refreshRequests(workspace)
    return cloudService.status()
  },

  async deny({ workspace, device }: { workspace: string; device: string }): Promise<Cloud> {
    const denied = await cloud.room({ method: 'DELETE', workspace: mustBeOn(workspace), path: `/requests/${encodeURIComponent(device)}`, token: await keysService.token() })
    if (denied.status !== 200 && denied.status !== 404) throw new HttpError(502, 'OpenHut Cloud couldn’t deny it. Try again.')
    await cloudEvents.refreshRequests(workspace)
    return cloudService.status()
  },

  async remove({ workspace, email }: { workspace: string; email: string }): Promise<Cloud> {
    await change({ ws: mustBeOn(workspace), emails: [email] })
    return cloudService.status()
  },

  async removeDevice({ workspace, device }: { workspace: string; device: string }): Promise<Cloud> {
    await change({ ws: mustBeOn(workspace), devices: [device] })
    await keepToRotate()
    return cloudService.status()
  },

  async changeKeys({ workspace }: { workspace: string }): Promise<Cloud> {
    mustBeOn(workspace)
    if (roomKeys.isOwn(workspace)) await serial(async () => rotate({ changed: await keysService.change(), drop: ['kit', 'kit-confirmed', 'passkey'] }))
    else await change({ ws: workspace, rotate: true })
    return cloudService.status()
  },

  async create({ name }: { name: string }): Promise<CloudWorkspaceView> {
    const room = await roomKeys.createTeam()
    const token = await keysService.token()
    const id = room.workspace.id
    const made = await cloud.memberLists({ token, list: room.list })
    if (made.status !== 200) {
      await roomKeys.dropRoom(id)
      throw new HttpError(502, 'OpenHut Cloud couldn’t make the team. Try again.')
    }
    const named = await cloud.room({ method: 'PATCH', workspace: id, path: '', token, body: { name: await roomKeys.lockMeta({ ws: id, field: 'name', plain: name }) } })
    if (named.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t name the team. Try again.')
    await cloudEvents.refreshName(id)
    const view = (await cloudService.status()).workspaces.find((each) => each.id === id)
    if (!view) throw new HttpError(500, `The new team didn’t open on this computer. Try again.`)
    return view
  },

  async deleteWorkspace({ workspace, name }: { workspace: string; name: string }): Promise<Cloud> {
    mustBeOn(workspace)
    if (roomKeys.isOwn(workspace)) throw new HttpError(403, 'This is your own team. To remove it, delete your cloud account in Settings › Backup.')
    const expected = cloudEvents.name(workspace)
    if (expected !== null && name.trim() !== expected.trim()) throw new HttpError(400, 'Type the team name exactly as it’s shown.', { param: 'name' })
    const deleted = await cloud.room({ method: 'DELETE', workspace, path: '', token: await keysService.token(), body: await keysService.deleteProof(workspace) })
    if (deleted.status === 403) throw new HttpError(403, 'Only an owner or admin can delete the team.')
    if (deleted.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t delete the team. Try again.')
    await cloudEvents.drop({ ws: workspace, why: null })
    return cloudService.status()
  },

  async deleteData(): Promise<Cloud> {
    if (keysService.locked() && !keysService.account()) return await deleteLocked()
    const account = keysService.mustBeOn()
    const teams = roomKeys.rooms().map((room) => room.workspace.id).filter((ws) => ws !== account.workspace.id)
    const shared = teams.find((ws) => roomKeys.roleIn(ws) === 'owner' && (roomKeys.members(ws)?.members.length ?? 0) > 1)
    if (shared) throw new HttpError(409, `Make someone else the owner of ${cloudEvents.name(shared)}, or delete it first.`)
    const owned = teams.filter((ws) => roomKeys.roleIn(ws) === 'owner')
    const token = await keysService.token()
    const proof = await keysService.accountProof()
    for (const ws of teams) await agentService.keepWorkspace(ws)
    for (const ws of teams) {
      const done = owned.includes(ws)
        ? cloud.room({ method: 'DELETE', workspace: ws, path: '', token, body: await keysService.deleteProof(ws) }).then(() => cloudEvents.drop({ ws, why: null }))
        : change({ ws, emails: [account.email] })
      await done.catch((err: unknown) => log.warn({ event: 'cloud.leave_failed', error: messageOf(err) }))
    }
    cloudEvents.stop()
    const wiped = await cloud.account({ method: 'DELETE', path: '/v1/account', token, body: proof })
    if (wiped.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t delete your account. Try again.')
    const home = await cloud.room({ method: 'DELETE', workspace: account.workspace.id, path: '', token, body: await keysService.deleteProof(account.workspace.id) })
    if (home.status !== 200 && home.status !== 404) throw new HttpError(502, 'OpenHut Cloud couldn’t delete your account. Try again.')
    await keysService.forgetHere()
    return cloudService.status()
  },

  async update({ workspace, name, website }: { workspace: string; name?: string; website?: string | null }): Promise<Cloud> {
    const ws = mustBeOn(workspace)
    const site = website === null ? '' : website && siteHost(website)
    if (site === null) throw new HttpError(400, 'Enter a website like example.com.', { param: 'website' })
    const body = {
      ...name === undefined ? {} : { name: await roomKeys.lockMeta({ ws, field: 'name', plain: name }) },
      ...site === undefined ? {} : { site: await roomKeys.lockMeta({ ws, field: 'site', plain: site }) },
    }
    if (!Object.keys(body).length) return cloudService.status()
    const what = name === undefined ? 'change the website of' : 'rename'
    const reply = await cloud.room({ method: 'PATCH', workspace: ws, path: '', token: await keysService.token(), body })
    if (reply.status === 403) throw new HttpError(403, `Only an owner or admin can ${what} the team.`)
    if (reply.status !== 200) throw new HttpError(502, `OpenHut Cloud couldn’t ${what} the team. Try again.`)
    await cloudEvents.refreshName(ws)
    return cloudService.status()
  },

  async icon({ workspace, reply }: { workspace: string; reply: FastifyReply }): Promise<FastifyReply> {
    const ws = mustBeOn(workspace)
    const site = cloudEvents.site(ws) || guessSite(roomKeys.members(ws)?.members ?? [])
    const icon = site && await teamIcon.get(site)
    if (!icon) throw new HttpError(404, 'This team has no website icon.')
    return reply.header('content-type', icon.type).header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'").header('cache-control', 'private, max-age=3600').send(icon.bytes)
  },

  async setRole({ workspace, email, role }: { workspace: string; email: string; role: Role }): Promise<Cloud> {
    const list = await roomKeys.withRole({ ws: mustBeOn(workspace), email, role })
    await putList({ workspace, list })
    return cloudService.status()
  },

  async revokeInvite({ workspace, email }: { workspace: string; email: string }): Promise<Cloud> {
    await putList({ workspace, list: await roomKeys.revoke({ ws: mustBeOn(workspace), email }) })
    return cloudService.status()
  },

  async start(): Promise<CloudAuthorization> {
    const device = await keysService.device()
    const state = randomBytes(24).toString('base64url')
    const { url } = await cloud.signIn({ provider: 'google', device: toBase64(device.publicKey), redirectUrl: `${callbackBase()}/api/cloud/callback`, state })
    for (const [key, at] of pending) if (Date.now() - at > PENDING_MS) pending.delete(key)
    pending.set(state, Date.now())
    signInError = null
    return { object: 'cloud_authorization', authorizationUrl: url }
  },

  async finish({ state, code, error }: { state?: string; code?: string; error?: string }): Promise<string> {
    const started = pending.has(state ?? '')
    pending.delete(state ?? '')
    if (!started) return page('This sign-in expired. Go back to OpenHut and try again.')
    if (!code) {
      signInError = error ? 'Sign-in was cancelled.' : 'Google didn’t finish the sign-in. Try again.'
      return page(`${signInError} You can go back to OpenHut.`)
    }
    try {
      const device = await keysService.device()
      const session = await cloud.claim({ code, signature: await signProof({ signer: device, proof: 'session', parts: [code] }) })
      keysService.ownedBy(session)
      await keysService.setSession({ token: session.token, refresh: session.refresh, expiresAt: session.expiresAt })
      const who = { sub: session.sub, email: session.email }
      if (keysService.account()?.sub !== session.sub) {
        if (await accountExists(session.token)) {
          await keysService.setLocked(who)
          return page(SIGNED_IN)
        }
      }
      const account = await keysService.open(who)
      if (!await openRoom({ account, token: session.token })) {
        await keysService.relock(who)
        return page(SIGNED_IN)
      }
      cloudService.connect()
      return page(SIGNED_IN)
    } catch (err) {
      signInError = messageOf(err)
      return page(`${signInError} Go back to OpenHut.`)
    }
  },

  async signOut(): Promise<Cloud> {
    await stopAsking()
    if (keysService.account()?.key && keysService.session()) await leaveHere()
    await keysService.setSession(undefined)
    await keysService.setLocked(undefined)
    cloudEvents.stop()
    signInError = null
    return cloudService.status()
  },

  async newKit(): Promise<RecoveryKit> {
    return serial(async () => {
      keysService.mustBeOn()
      if (keysService.kitState().saved) await rotate({ changed: await keysService.change(), drop: ['passkey'] })
      const { words, box, ask } = await keysService.newKit()
      const token = await keysService.token()
      const kept = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })).json).data
      const savedAt = Math.max(Date.now(), (Date.parse(kept?.savedAt ?? '') || 0) + 1)
      await keysService.setKit({ box, savedAt: new Date(savedAt).toISOString(), confirmed: false })
      const signer = keysService.mustBeOn()
      try {
        const saved = await cloud.account({ method: 'PUT', path: '/v1/key-boxes/kit', token, body: await keysService.signBox({ account: signer, name: 'kit', body: box, savedAt }) })
        boxesDiffer = saved.status === 403
        if (saved.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t save your recovery kit. Try again.')
      } catch (err) {
        await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token }).then((got) => dropPending({ account: signer, token, cloudKit: KeyBox.safeParse(got.json).data })).catch(warnCheck)
        throw err
      }
      await keysService.setKit({ box, savedAt: new Date(savedAt).toISOString() })
      await confirmKit({ account: signer, token, body: box, savedAt }).catch(warnCheck)
      return { object: 'recovery_kit' as const, words, ask, kitId: await kitId(box), madeAt: new Date(savedAt).toISOString(), device: deviceName() }
    })
  },

  async unlock(body: UnlockCloud): Promise<Cloud> {
    mustBeLocked()
    const token = await keysService.token()
    const kind = 'words' in body ? 'kit' : 'passkey'
    const box = KeyBox.safeParse((await cloud.account({ method: 'GET', path: `/v1/key-boxes/${kind}`, token })).json).data
    if (!box && kind === 'kit') throw new HttpError(409, `There’s no recovery kit for this account yet. Save one on the computer you set up first, then type its words here.`)
    if (!box) throw new HttpError(409, `Touch ID isn’t set up for this account yet. Add it in Settings › Backup on a Mac that’s already unlocked.`)
    const workspaces = await boxesOf(token)
    const account = 'words' in body
      ? await keysService.restore({ words: body.words, kit: box.body, workspaces })
      : await keysService.fromPasskey({ prf: fromBase64(body.prf), box: box.body }).then((key) => key && keysService.restoreWith({ key, workspaces }))
    if (!account && 'words' in body) throw new HttpError(400, 'Those aren’t the words of your recovery kit. Check each word and try again.', { param: 'words' })
    if (!account) throw new HttpError(400, `Touch ID isn’t set up on this Mac. Unlock another way.`)
    return joinWith({ account, typed: 'words' in body })
  },

  async addPasskey({ prf }: { prf: string }): Promise<Cloud> {
    const saved = await cloud.account({ method: 'PUT', path: '/v1/key-boxes/passkey', token: await keysService.token(), body: await keysService.passkeyBox(fromBase64(prf)) })
    boxesDiffer ||= saved.status === 403
    if (saved.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t save Touch ID. Try again.')
    passkeySaved = true
    return cloudService.status()
  },

  async notMe({ device }: { device: string }): Promise<Cloud> {
    const account = keysService.mustBeOn()
    const mine = (ws: string) => Boolean(roomKeys.members(ws)?.members.some((member) => member.email === account.email && member.devices.includes(device)))
    const teams = roomKeys.rooms().map((room) => room.workspace.id).filter((ws) => ws !== account.workspace.id && mine(ws))
    if (!mine(account.workspace.id) && !teams.length) throw new HttpError(400, 'Pick one of your other devices to remove.', { param: 'device' })
    if (mine(account.workspace.id)) await serial(async () => putList({ workspace: account.workspace.id, list: await keysService.dropDevices([device]) }))
    for (const ws of teams) await change({ ws, devices: [device] })
    await keepToRotate()
    return cloudService.status()
  },

  async rotated(): Promise<Cloud> {
    await db.deleteFrom('install_setting').where('name', '=', ROTATE).execute()
    return cloudService.status()
  },

  connect(): void {
    if (config.join && !keysService.account()) void joinAsServer(config.join).catch((err: unknown) => log.error({ event: 'cloud.join_failed', error: messageOf(err) }))
    cloudEvents.start()
    checkSoon()
  },
}

export function mustBeOn(workspace: string): string {
  if (!keysService.session() || !roomKeys.room(workspace)) throw new HttpError(409, 'Enable OpenHut Cloud and open this team first.')
  return workspace
}

export async function putList({ workspace, list, letters, boxes }: { workspace: string; list: MemberList; letters?: Sealed[]; boxes?: Box[] }): Promise<void> {
  const put = await cloud.memberLists({ token: await keysService.token(), list, letters, boxes }).catch(() => ({ status: 0 }))
  if (put.status !== 200) throw await refusal({ ws: workspace, status: put.status })
  await roomKeys.advance({ lists: [list], ws: workspace })
}

async function change({ ws, emails, devices, rotate = false }: { ws: string; emails?: string[]; devices?: string[]; rotate?: boolean }): Promise<void> {
  const { list, room, letters } = await roomKeys.teamChange({ ws, emails, devices, rotate })
  await putList({ workspace: ws, list, letters })
  if (emails?.includes(keysService.account()?.email ?? '')) return cloudEvents.drop({ ws, why: null })
  if (rotate) await roomKeys.setRoom(room)
}

async function refusal({ ws, status }: { ws: string; status: number }): Promise<HttpError> {
  if (status === 409) return new HttpError(409, CHANGED)
  if (status !== 403) return new HttpError(502, 'OpenHut Cloud couldn’t save the change. Try again.')
  const newer = await cloud.room({ method: 'GET', workspace: ws, path: `/member-lists?after=${roomKeys.members(ws)?.version ?? 0}`, token: await keysService.token() }).catch(() => null)
  if (newer?.status === 403 || (Newer.safeParse(newer?.json).data?.data.length ?? 0) > 0) return new HttpError(409, CHANGED)
  return new HttpError(403, 'OpenHut Cloud couldn’t save the change. Try again.')
}

async function serverApproval({ device, name }: { device: string; name: string | null }): Promise<{ list: MemberList; letter: Sealed }> {
  const account = keysService.mustBeOn()
  const list = await keysService.addDevice({ device, name })
  if (!list) throw new HttpError(409, 'That computer is already on your account.')
  return { list, letter: await sealTo({ to: device, purpose: 'workspace-key', workspace: account.workspace.id, plain: await keysService.secret() }) }
}

async function joinAsServer(code: string): Promise<void> {
  if (keysService.session() && keysService.locked()) return void resumeAsking()
  const session = await keysService.joinSession(code)
  await keysService.setLocked({ sub: session.sub, email: session.email })
  await cloudService.ask()
}

function kitOf(): { savedAt: string; differs: boolean } | null {
  const kit = keysService.kitState().saved
  return kit || boxesDiffer ? { savedAt: kit?.savedAt ?? new Date(0).toISOString(), differs: boxesDiffer } : null
}

async function accountExists(token: string): Promise<boolean> {
  const workspaces = await cloud.account({ method: 'GET', path: '/v1/workspaces', token })
  const listed = Workspaces.safeParse(workspaces.json).data
  if (workspaces.status !== 200 || !listed) throw new HttpError(502, 'OpenHut Cloud couldn’t check for a backup. Try again.')
  return listed.data.length > 0 || (await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })).status === 200
}

async function cloudBox(kind: 'kit' | 'passkey'): Promise<{ status: number; json: unknown }> {
  return await cloud.account({ method: 'GET', path: `/v1/key-boxes/${kind}`, token: await keysService.token() }).catch(() => ({ status: 0, json: null }))
}

async function boxInCloud(kind: 'kit' | 'passkey'): Promise<boolean> {
  return (await cloudBox(kind)).status !== 404
}

async function kitInCloud(): Promise<{ found: boolean; kit: { id: string; savedAt: string | null } | null }> {
  const got = await cloudBox('kit')
  const box = KeyBox.safeParse(got.json).data
  return { found: got.status !== 404, kit: box ? { id: await kitId(box.body), savedAt: box.savedAt ?? null } : null }
}

function serial<T>(step: () => Promise<T>): Promise<T> {
  const next = boxes.then(step)
  boxes = next.catch(() => undefined)
  return next
}

function checkSoon(): void {
  checkedAt = Date.now()
  if (!keysService.account()?.key || !keysService.session()) return
  checkBoxes().catch(warnCheck)
  const home = keysService.account()?.workspace.id
  void keysService.token().then((token) => cloud.account({ method: 'PUT', path: '/v1/teams', token, body: { ids: roomKeys.rooms().map((room) => room.workspace.id).filter((id) => id !== home) } })).catch(warnCheck)
}

function warnCheck(err: unknown): void {
  log.warn({ event: 'cloud.box_check_failed', error: messageOf(err) })
}

function checkBoxes(): Promise<void> {
  return serial(compareBoxes)
}

async function compareBoxes(): Promise<void> {
  const account = keysService.account()
  if (!account) return
  const token = await keysService.token()
  const kit = await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })
  const workspaces = await cloud.account({ method: 'GET', path: '/v1/workspaces', token })
  if (![200, 404].includes(kit.status) || workspaces.status !== 200) return
  if (!Workspaces.safeParse(workspaces.json).data?.data.some((each) => each.id === account.workspace.id)) return lockOut(account)
  const cloudKit = await dropPending({ account, token, cloudKit: KeyBox.safeParse(kit.json).data })
  const mine = keysService.kitState().saved?.box
  const kitMine = Boolean(cloudKit && await keysService.boxIsMine({ account, name: 'kit', box: cloudKit }))
  const marker = cloudKit && kitMine ? await markerOf({ account, token, kit: cloudKit }) : undefined
  if (cloudKit && marker?.confirmed && cloudKit.body !== mine) await keysService.setKit({ box: cloudKit.body, savedAt: cloudKit.savedAt ?? new Date().toISOString() })
  if (marker && !marker.confirmed && mine && cloudKit?.body === mine) await confirmKit({ account, token, body: mine, savedAt: Math.max(Date.now(), marker.savedAt + 1) })
  if (cloudKit && !kitMine && mine) await keysService.setKit(undefined)
  const passkey = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/passkey', token })).json).data
  passkeySaved = Boolean(passkey && await keysService.boxIsMine({ account, name: 'passkey', box: passkey }))
  boxesDiffer = Boolean(cloudKit && !kitMine)
}

async function dropPending({ account, token, cloudKit }: { account: Account; token: string; cloudKit: KeyBox | undefined }): Promise<KeyBox | undefined> {
  const pending = keysService.kitState().pending
  if (!pending) return cloudKit
  if (cloudKit?.body === pending && !await deleteBoxes({ account, token, kinds: ['kit', 'kit-confirmed'] })) return cloudKit
  await keysService.setKit(undefined)
  return cloudKit?.body === pending ? undefined : cloudKit
}

async function markerOf({ account, token, kit }: { account: Account; token: string; kit: KeyBox }): Promise<{ confirmed: boolean; savedAt: number }> {
  const marker = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit-confirmed', token })).json).data
  return { confirmed: Boolean(marker && marker.body === kit.body && await keysService.boxIsMine({ account, name: 'kit-confirmed', box: marker })), savedAt: Date.parse(marker?.savedAt ?? '') || 0 }
}

async function confirmKit({ account, token, body, savedAt }: { account: Account; token: string; body: string; savedAt: number }): Promise<void> {
  await cloud.account({ method: 'PUT', path: '/v1/key-boxes/kit-confirmed', token, body: await keysService.signBox({ account, name: 'kit-confirmed', body, savedAt }) })
}

async function deleteBoxes({ account, token, kinds }: { account: Account; token: string; kinds: string[] }): Promise<boolean> {
  let deleted = true
  for (const kind of kinds) {
    const { by, signature } = await keysService.signBox({ account, name: `delete/${kind}`, body: '' })
    const gone = await cloud.account({ method: 'DELETE', path: `/v1/key-boxes/${kind}`, token, body: { by, signature } })
    deleted &&= gone.status === 200 || gone.status === 404
  }
  return deleted
}

async function lockOut({ sub, email }: Account): Promise<void> {
  cloudEvents.stop()
  await keysService.relock({ sub, email })
  boxesDiffer = false
}

async function boxesOf(token: string): Promise<{ id: string; key: string; chain: MemberList[] }[]> {
  const boxes = Workspaces.safeParse((await cloud.account({ method: 'GET', path: '/v1/workspaces', token })).json).data?.data ?? []
  return Promise.all(boxes.map(async (box) => ({ ...box, chain: await chainOf({ workspace: box.id, token }) })))
}

async function chainOf({ workspace, token }: { workspace: string; token: string }): Promise<MemberList[]> {
  const chain: MemberList[] = []
  for (let more = true; more;) {
    const page = Lists.safeParse((await cloud.room({ method: 'GET', workspace, path: `/member-lists?after=${bodyOf(chain.at(-1))?.version ?? 0}`, token })).json).data
    chain.push(...page?.data ?? [])
    more = Boolean(page?.hasMore && page.data.length)
  }
  return chain
}

async function joinWith({ account: restored, typed }: { account: Account; typed: boolean }): Promise<Cloud> {
  const token = await keysService.token()
  const joined = await cloud.memberLists({ token, list: restored.list })
  if (joined.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t add this computer. Try again.')
  const teams = []
  for (const team of restored.teams ?? []) if ((await cloud.memberLists({ token, list: team.list })).status === 200) teams.push(team)
  const account = { ...restored, teams }
  const kit = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })).json).data
  const kept = kit && (typed || (await markerOf({ account, token, kit })).confirmed)
  await keysService.adopt({ account, kit: kit && kept ? { box: kit.body, savedAt: kit.savedAt ?? new Date().toISOString() } : undefined })
  cloudService.connect()
  return cloudService.status()
}

async function leaveHere(): Promise<void> {
  if (!await recordsService.sent()) throw new HttpError(409, 'Your agents aren’t backed up yet. Sign out once this computer is online and the backup is done, so nothing is lost.')
  const me = await keysService.deviceKey()
  cloudEvents.stop()
  await agentService.forgetDevice({ device: me })
  await agentService.wipe()
  await connectionService.wipe()
  await keysService.forgetHere()
}

async function removed(): Promise<void> {
  await stopAsking()
  await keysService.removedHere()
  throw new HttpError(403, `This computer was removed from your account. Sign in again to add it back.`)
}

function listedUnder({ account, device }: { account: Account; device: string }): boolean {
  return Boolean(bodyOf(account.list)?.members.some((member) => member.email === account.email && member.devices.includes(device)))
}

async function deleteLocked(): Promise<Cloud> {
  mustBeLocked()
  const wiped = await cloud.account({ method: 'DELETE', path: '/v1/account', token: await keysService.token() })
  if (wiped.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t delete your account. Try again.')
  await keysService.forgetHere()
  return cloudService.status()
}

function mustBeLocked(): { sub: string; email: string } {
  const locked = keysService.locked()
  if (!locked || keysService.account() || !keysService.session()) throw new HttpError(409, 'This computer isn’t waiting to unlock. Sign in to OpenHut Cloud first.')
  return locked
}

async function checkAsked(): Promise<void> {
  const now = asking
  if (!now) return
  if (!keysService.locked()) return stopAsking()
  const token = await keysService.token()
  const me = await keysService.deviceKey()
  for (const { id: workspace, own } of keysService.asked().filter((each) => !now.settled.includes(each.id))) {
    const got = await cloud.room({ method: 'GET', workspace, path: '/letters', token })
    if (got.status === 403 && own) return removed()
    const found = Letters.safeParse(got.json).data?.data ?? []
    if (own && await unlockedBy({ workspace, found, token })) return
    const chain = (!own || config.installKind === 'server') && found.length ? await chainOf({ workspace, token }) : []
    if (chain.length && await roomKeys.joinApproved({ ws: workspace, chain, found })) {
      for (const each of found) await cloud.room({ method: 'DELETE', workspace, path: `/letters/${each.id}`, token })
      now.settled.push(workspace)
      now.approved = true
      cloudService.connect()
      continue
    }
    const mine = (Asked.safeParse((await cloud.room({ method: 'GET', workspace, path: '/requests', token })).json).data?.data ?? []).find((each) => each.device === me)
    if (!mine) now.settled.push(workspace)
  }
  if (now.settled.length < keysService.asked().length) return
  if (now.approved) return stopAsking()
  clearInterval(now.timer)
}

async function unlockedBy({ workspace, found, token }: { workspace: string; found: Letter[]; token: string }): Promise<boolean> {
  for (const each of found.filter((one) => one.purpose === 'account-key')) {
    const key = await openLetter({ found: each, workspace })
    const boxes = key ? await boxesOf(token) : []
    const account = key && await keysService.restoreWith({ key, workspaces: [...boxes.filter((box) => box.id === workspace), ...boxes.filter((box) => box.id !== workspace)] })
    if (!account || !listedUnder({ account, device: each.from })) continue
    await joinWith({ account, typed: false })
    await cloud.room({ method: 'DELETE', workspace, path: `/letters/${each.id}`, token }).catch(() => undefined)
    await stopAsking()
    return true
  }
  return false
}

function resumeAsking(): typeof asking {
  if (!asking && keysService.session() && keysService.asked().length) asking = { settled: [], approved: false, error: null, timer: setInterval(pollAsked, ASK_POLL_MS) }
  return asking
}

function pollAsked(): void {
  if (polling) return
  polling = true
  void checkAsked().catch((err: unknown) => log.warn({ event: 'cloud.ask_failed', error: messageOf(err) })).finally(() => { polling = false })
}

async function stopAsking(): Promise<void> {
  clearInterval(asking?.timer)
  asking = undefined
  if (keysService.asked().length) await keysService.setAsked([])
}

async function rotate({ changed: { list, next, letters }, drop }: { changed: Awaited<ReturnType<typeof keysService.change>>; drop: ('kit' | 'kit-confirmed' | 'passkey')[] }): Promise<void> {
  const token = await keysService.token()
  const workspaces = await Promise.all([next, ...(next.teams ?? []).filter((each) => each.workspace.key)].map((room) => keysService.workspaceBox({ account: next, room })))
  const boxes: Box[] = [
    ...workspaces.map(({ id, key, by, signature }) => ({ name: `workspace/${id}`, body: key, by, signature })),
    ...await Promise.all(drop.map(async (name) => ({ name, deleted: true, ...await keysService.signBox({ account: next, name: `delete/${name}`, body: '' }) }))),
  ]
  const put = await cloud.memberLists({ token, list, letters, boxes })
  if (put.status === 409) throw new HttpError(409, 'Your devices changed on another computer just now. Try again.')
  if (put.status !== 200) throw new HttpError(put.status === 403 ? 403 : 502, 'OpenHut Cloud couldn’t save the change. Try again.')
  await keysService.adopt({ account: next })
  passkeySaved = false
  for (const team of next.teams ?? []) await cloudEvents.refreshKeys(team.workspace.id)
}

function page(sentence: string): string {
  const text = sentence.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenHut</title><body style="margin:0;display:grid;place-items:center;min-height:90vh;font:15px/1.5 -apple-system,system-ui,sans-serif;color:#0b0b0b;background:#fff"><p style="max-width:420px;padding:0 16px;text-align:center">${text}</p></body>`
}

async function openRoom({ account, token }: { account: Account; token: string }): Promise<boolean> {
  const { id, key, by, signature } = await keysService.workspaceBox({ account })
  const made = await cloud.memberLists({ token, list: account.list, boxes: [{ name: `workspace/${id}`, body: key, by, signature }] })
  if (made.status === 403) return false
  if (made.status !== 200 && made.status !== 409) throw new HttpError(502, 'OpenHut Cloud couldn’t open this team. Try again.')
  return true
}

async function teamsOf(token: string): Promise<{ id: string }[]> {
  return Teams.safeParse((await cloud.account({ method: 'GET', path: '/v1/teams', token })).json).data?.data ?? []
}

async function keepToRotate(): Promise<void> {
  const value = JSON.stringify(await connectionService.rotatable())
  await db.insertInto('install_setting').values({ name: ROTATE, value }).onConflict((oc) => oc.column('name').doUpdateSet({ value })).execute()
}

async function toRotate(): Promise<Cloud['rotate']> {
  const row = await db.selectFrom('install_setting').select('value').where('name', '=', ROTATE).executeTakeFirst()
  return z.safeParse(Rotate, JSON.parse(row?.value ?? '[]')).data ?? []
}
