import { randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import * as z from 'zod/mini'
import { checkProof, type CloudWorkspaceView, fromQr, KeyBox, Letter, MemberList, qrPayload, signProof, WordsNonce, type AllowedDevice, type Role, type Cloud, type CloudAuthorization, type CloudPairing, type RecoveryKit, type RuntimeInvite, type UnlockCloud, siteHost } from '@openhut/common/cloud/cloud.ts'
import { addedOf, bodyOf, check, newUntil, youngUntil } from '@openhut/common/cloud/member-list.ts'
import { askCommit, deviceWords, fingerprint, fromBase64, fromLongCode, letter, longCode, newKey, newPairing, toBase64 } from '@openhut/common/vault/vault.ts'
import { kitId } from '@openhut/common/vault/kit-file.ts'
import { cloud } from '../platform/cloud.ts'
import { db } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { callbackBase, connectionService } from '../connections/connection-service.ts'
import { keyStore, type Account, type AskRoom, type Move, type Room } from './key-store.ts'
import { deviceName, deviceOs, keysService, notYoung, openLetter, readSecret } from './keys-service.ts'
import { roomKeys } from './room-keys.ts'
import { guessSite, teamIcon } from './team-icon.ts'
import { refusal, syncService } from './sync-service.ts'
import { agentService } from '../agents/agent-service.ts'

const PENDING_MS = 15 * 60_000
const CHECK_MS = 60_000
const PAIRING_POLL_MS = 2000
const SIGNED_IN = 'You’re signed in. You can go back to OpenHut.'
const Workspaces = z.object({ data: z.array(z.object({ id: z.string(), key: z.string(), by: z.optional(z.string()), signature: z.optional(z.string()) })) })
const Lists = z.object({ data: z.array(MemberList), hasMore: z.optional(z.boolean()) })
const Letters = z.object({ data: z.array(Letter) })
const Waiting = z.object({ data: z.array(z.object({ device: z.string() })) })
const Asked = z.object({ data: z.array(z.object({ device: z.string(), nonce: z.nullable(WordsNonce) })) })
const ROTATE = 'cloud_rotate'
const Teams = z.object({ data: z.array(z.object({ id: z.string() })) })
const ASK_POLL_MS = 2000
const pending = new Map<string, number>()
let signInError: string | null = null
let boxesDiffer = false
let checkedAt = 0
let boxes: Promise<unknown> = Promise.resolve()
let passkeySaved = false
let pairing: { secret: string; reply: CloudPairing; workspaces: string[]; timer: NodeJS.Timeout } | undefined
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
    const young = on && members ? youngUntil(members, here) : 0
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
      object: 'cloud', status: locked ? 'locked' : on ? (syncService.ready() ? 'on' : 'offline') : 'off', email: locked?.email ?? (on && account ? account.email : null),
      device: here,
      workspace: on && account && members ? { id: account.workspace.id, version: members.version, members: members.members } : null,
      keyStore: keyStore.kind(), kit: on ? kitOf() : null, kitInCloud: inCloud ? inCloud.found : Boolean(keysService.kitState().saved), cloudKit: inCloud?.kit ?? null, backup: syncService.status(),
      signInError, keptAccount: on ? null : (keysService.kitState().saved ? keysService.account()?.email ?? null : null), devices, passkey: on ? passkeySaved : passkeyInCloud, youngUntil: young > Date.now() ? new Date(young).toISOString() : null, needsSignIn: Boolean(locked && !session),
      workspaces: on && account ? roomKeys.rooms().map(({ workspace: { id, key } }) => {
        const body = roomKeys.members(id)
        const invites = (body?.invites ?? []).map((each) => ({ email: each.email, role: each.role, link: roomKeys.link({ ws: id, email: each.email }) ?? null }))
        return { id, name: syncService.name(id), website: syncService.site(id), home: id === account.workspace.id, own: roomKeys.isOwn(id), role: roomKeys.roleIn(id) ?? 'member', waiting: !key, members: body?.members ?? [], invites, requests: syncService.requests(id), names: body?.names ?? {} }
      }) : [],
      asking: asked ? { rooms: askRooms.filter((room) => !asked.settled.includes(room.id)).map(({ admins, words, revealed }) => ({ admins, words: revealed && words ? words : null })), denied: asked.settled.length === askRooms.length, error: asked.error } : null,
      canAsk: Boolean(locked && session && await teamsOf(session.token).then((teams) => teams.length > 0, () => false)),
      rotate: on ? await toRotate() : [],
      gone: syncService.gone(),
    }
  },

  async ask(): Promise<Cloud> {
    mustBeLocked()
    await stopAsking()
    const token = await keysService.token()
    const teams = await teamsOf(token)
    const me = fromBase64(await keysService.deviceKey())
    const rooms: AskRoom[] = []
    let refused: string | null = null
    for (const { id } of teams) {
      const lists = await chainOf({ workspace: id, token })
      const body = bodyOf(lists.at(-1))
      const others = body?.members.filter((member) => member.role !== 'member' && member.email !== keysService.locked()?.email) ?? []
      if (!others.length) continue
      const secret = newKey()
      const asked = await cloud.room({ method: 'POST', workspace: id, path: '/requests', token, body: { name: deviceName(), os: deviceOs(), commit: toBase64(await askCommit({ device: me, reveal: secret })) } })
      if (asked.status !== 200) refused = z.safeParse(z.object({ error: z.object({ message: z.string() }) }), asked.json).data?.error.message ?? 'OpenHut Cloud couldn’t send your request. Try again.'
      if (asked.status !== 200) continue
      rooms.push({ id, admins: others.map((member) => member.email), signers: others.flatMap((member) => member.devices), secret: toBase64(secret) })
    }
    if (!rooms.length) throw new HttpError(409, refused ?? 'None of your team workspaces has an admin who can let this Mac in. Pick another way.')
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

  async approve({ workspace, device, words }: { workspace: string; device: string; words: string[] }): Promise<Cloud> {
    const asked = syncService.requests(mustBeOn(workspace)).find((each) => each.device === device)
    if (!asked) throw new HttpError(404, 'That device isn’t waiting anymore. It was let in, denied, or it expired.')
    if (!asked.nonce || !asked.reveal) throw new HttpError(409, 'Their 4 words aren’t ready yet. Wait a moment and try again.')
    const { list, letter: sealed } = await roomKeys.approve({ ws: workspace, email: asked.email, device, words, nonce: asked.nonce.nonce, reveal: asked.reveal, name: asked.name })
    await putList({ workspace, list })
    await roomKeys.post([{ ...sealed, workspace }])
    await syncService.refreshRequests(workspace)
    return cloudService.status()
  },

  async deny({ workspace, device }: { workspace: string; device: string }): Promise<Cloud> {
    const denied = await cloud.room({ method: 'DELETE', workspace: mustBeOn(workspace), path: `/requests/${encodeURIComponent(device)}`, token: await keysService.token() })
    if (denied.status !== 200 && denied.status !== 404) throw new HttpError(502, 'OpenHut Cloud couldn’t deny it. Try again.')
    await syncService.refreshRequests(workspace)
    return cloudService.status()
  },

  async remove({ workspace, email }: { workspace: string; email: string }): Promise<Cloud> {
    await syncService.change({ ws: mustBeOn(workspace), emails: [email] })
    return cloudService.status()
  },

  async removeDevice({ workspace, device }: { workspace: string; device: string }): Promise<Cloud> {
    await syncService.change({ ws: mustBeOn(workspace), devices: [device] })
    await keepToRotate()
    return cloudService.status()
  },

  async changeKeys({ workspace }: { workspace: string }): Promise<Cloud> {
    mustBeOn(workspace)
    if (roomKeys.isOwn(workspace)) await serial(async () => rotate({ changed: await keysService.change(), drop: ['kit', 'kit-confirmed', 'passkey'] }))
    else await syncService.change({ ws: workspace, rotate: true })
    return cloudService.status()
  },

  async create({ name }: { name: string }): Promise<CloudWorkspaceView> {
    const room = await roomKeys.createTeam()
    const token = await keysService.token()
    const id = room.workspace.id
    const made = await cloud.room({ method: 'PUT', workspace: id, path: '/members', token, body: room.list })
    if (made.status !== 200) {
      await roomKeys.dropRoom(id)
      throw new HttpError(502, 'OpenHut Cloud couldn’t make the workspace. Try again.')
    }
    const named = await cloud.room({ method: 'PATCH', workspace: id, path: '', token, body: { name: await roomKeys.lockMeta({ ws: id, field: 'name', plain: name }) } })
    if (named.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t name the workspace. Try again.')
    syncService.connect()
    await syncService.refreshName(id)
    const view = (await cloudService.status()).workspaces.find((each) => each.id === id)
    if (!view) throw new HttpError(500, `The new workspace didn’t open on this computer. Try again.`)
    return view
  },

  async deleteWorkspace({ workspace, name }: { workspace: string; name: string }): Promise<Cloud> {
    mustBeOn(workspace)
    if (roomKeys.isOwn(workspace)) throw new HttpError(403, 'This is your own workspace. To remove it, delete your cloud account in Settings › Backup.')
    const expected = syncService.name(workspace)
    if (expected !== null && name.trim() !== expected.trim()) throw new HttpError(400, 'Type the workspace name exactly as it’s shown.', { param: 'name' })
    await notNew(workspace)
    syncService.leaving({ ws: workspace, on: true })
    const deleted = await cloud.room({ method: 'DELETE', workspace, path: '', token: await keysService.token(), body: await keysService.deleteProof(workspace) })
    if (deleted.status !== 200) syncService.leaving({ ws: workspace, on: false })
    if (deleted.status === 403) throw new HttpError(403, 'Only an owner or admin can delete the workspace.')
    if (deleted.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t delete the workspace. Try again.')
    await syncService.drop(workspace)
    return cloudService.status()
  },

  async deleteData(): Promise<Cloud> {
    if (keysService.locked() && !keysService.account()) return await deleteLocked()
    const account = keysService.mustBeOn()
    const teams = roomKeys.rooms().map((room) => room.workspace.id).filter((ws) => ws !== account.workspace.id)
    const shared = teams.find((ws) => roomKeys.roleIn(ws) === 'owner' && (roomKeys.members(ws)?.members.length ?? 0) > 1)
    if (shared) throw new HttpError(409, `Make someone else the owner of ${syncService.name(shared)}, or delete it first.`)
    const owned = teams.filter((ws) => roomKeys.roleIn(ws) === 'owner')
    for (const ws of [account.workspace.id, ...owned]) await notNew(ws)
    const token = await keysService.token()
    const proof = await keysService.accountProof()
    for (const ws of teams) await agentService.keepWorkspace(ws)
    for (const ws of teams) {
      const done = owned.includes(ws)
        ? cloud.room({ method: 'DELETE', workspace: ws, path: '', token, body: await keysService.deleteProof(ws) }).then(() => syncService.drop(ws))
        : syncService.change({ ws, emails: [account.email] })
      await done.catch((err: unknown) => log.warn({ event: 'cloud.leave_failed', error: messageOf(err) }))
    }
    syncService.disconnect()
    const wiped = await cloud.account({ method: 'DELETE', path: '/v1/account', token, body: proof })
    if (wiped.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t delete your account. Try again.')
    const home = await cloud.room({ method: 'DELETE', workspace: account.workspace.id, path: '', token, body: await keysService.deleteProof(account.workspace.id) })
    if (home.status !== 200 && home.status !== 404) throw new HttpError(502, 'OpenHut Cloud couldn’t delete your account. Try again.')
    await syncService.reset({ restoring: false })
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
    if (reply.status === 403) throw new HttpError(403, `Only an owner or admin can ${what} the workspace.`)
    if (reply.status !== 200) throw new HttpError(502, `OpenHut Cloud couldn’t ${what} the workspace. Try again.`)
    await syncService.refreshName(ws)
    return cloudService.status()
  },

  async icon({ workspace, reply }: { workspace: string; reply: FastifyReply }): Promise<FastifyReply> {
    const ws = mustBeOn(workspace)
    const site = syncService.site(ws) || guessSite(roomKeys.members(ws)?.members ?? [])
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
        await syncService.reset({ restoring: false })
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

  async forget(): Promise<Cloud> {
    const former = await keysService.deviceKey()
    await keysService.forget()
    await agentService.forgetDevice({ device: former })
    signInError = null
    return cloudService.status()
  },

  async signOut(): Promise<Cloud> {
    stopPairing()
    if (keysService.account()?.key && keysService.session()) await checkBoxes().catch(warnCheck)
    await keysService.setSession(undefined)
    await keysService.setLocked(undefined)
    syncService.disconnect()
    return cloudService.status()
  },

  async newKit(): Promise<RecoveryKit> {
    return serial(async () => {
      keysService.mustBeOn()
      if (keysService.kitState().saved) await rotate({ changed: await keysService.change(), drop: ['passkey'] })
      const { words, box, ask } = await keysService.newKit()
      const token = await keysService.token()
      await finishMoves(token)
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

  async startOver(): Promise<Cloud> {
    const locked = mustBeLocked()
    const token = await keysService.token()
    const cleared = await cloud.account({ method: 'DELETE', path: '/v1/key-boxes', token })
    if (cleared.status === 409) throw new HttpError(409, 'Your recovery kit is in OpenHut Cloud now. Type its words to unlock.')
    if (cleared.status === 403) throw new HttpError(403, `This account is set up on another device. Unlock with your iPhone or another computer.`)
    if (cleared.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t start over. Try again.')
    await syncService.reset({ restoring: false })
    const account = await keysService.open(locked)
    if (!await openRoom({ account, token })) {
      await keysService.relock(locked)
      throw new HttpError(409, `Your other computer started over a moment ago. Check again.`)
    }
    cloudService.connect()
    return cloudService.status()
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

  async startPairing(): Promise<CloudPairing> {
    const locked = mustBeLocked()
    stopPairing()
    const workspaces = (await boxesOf(await keysService.token())).map((box) => box.id)
    const made = await newPairing({ device: (await keysService.device()).publicKey, hint: locked.email })
    const reply: CloudPairing = { object: 'pairing', qr: qrPayload(made), code: longCode(made.secret), expiresAt: new Date(Date.now() + PENDING_MS).toISOString() }
    pairing = { secret: made.secret, reply, workspaces, timer: setInterval(() => void checkPairing().catch((err: unknown) => log.warn({ event: 'cloud.pairing_failed', error: messageOf(err) })), PAIRING_POLL_MS) }
    await checkPairing()
    return reply
  },

  async allow({ code }: { code: string }): Promise<AllowedDevice> {
    const account = keysService.mustBeOn()
    const qr = fromQr(code)
    const secret = qr?.secret ?? fromLongCode(code)
    if (!secret) throw new HttpError(400, 'That code isn’t right. Check each character and try again.', { param: 'code' })
    const token = await keysService.token()
    const waiting = Waiting.safeParse((await cloud.room({ method: 'GET', workspace: account.workspace.id, path: '/waiting', token })).json).data?.data ?? []
    const devices: string[] = []
    for (const { device } of waiting) if (!qr || await fingerprint(fromBase64(device)) === qr.fingerprint) devices.push(device)
    if (!devices.length) throw new HttpError(409, `That computer isn’t waiting for a code. Keep OpenHut open on its code screen and try again.`)
    if (await roomKeys.post(await Promise.all(devices.map(async (to) => ({ ...await keysService.pairingLetter({ to, secret }), workspace: account.workspace.id }))))) throw new HttpError(502, 'OpenHut Cloud couldn’t add that Mac. Try again.')
    return { object: 'pairing_allowed', devices }
  },

  async addPasskey({ prf }: { prf: string }): Promise<Cloud> {
    await notYoung(keysService.mustBeOn())
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
    for (const ws of teams) await syncService.change({ ws, devices: [device] })
    await keepToRotate()
    return cloudService.status()
  },

  async rotated(): Promise<Cloud> {
    await db.deleteFrom('install_setting').where('name', '=', ROTATE).execute()
    return cloudService.status()
  },

  async addRuntime({ device }: { device: string }): Promise<RuntimeInvite> {
    const account = keysService.account()
    const me = roomKeys.members()?.members.find((member) => member.email === account?.email)
    if (!account || !keysService.session()) throw new HttpError(409, `Enable OpenHut Cloud on this computer first.`)
    if (!me || me.role === 'member') throw new HttpError(403, 'Only an owner or admin can add a computer that runs agents.')
    const token = await keysService.token()
    const list = await keysService.addDevice(device)
    if (list) {
      const put = await cloud.room({ method: 'PUT', workspace: account.workspace.id, path: '/members', token, body: list })
      if (put.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t add that computer. Try again.')
      await roomKeys.advance({ lists: [list] })
    }
    const signer = await keysService.device()
    const body = await letter({ sender: signer, to: fromBase64(device), workspace: account.workspace.id, purpose: 'workspace-key', version: account.workspace.version, plain: await keysService.secret() })
    const sent = body && await cloud.room({ method: 'POST', workspace: account.workspace.id, path: '/letters', token, body: { to: device, purpose: 'workspace-key', body: toBase64(body) } })
    if (sent?.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t add that computer. Try again.')
    return { object: 'runtime_invite', workspace: account.workspace.id, email: account.email, from: toBase64(signer.publicKey) }
  },

  async join({ workspace, email, from }: Omit<RuntimeInvite, 'object'>): Promise<Cloud> {
    if (keysService.account()) throw new HttpError(409, 'This computer is already on OpenHut Cloud.')
    const session = await keysService.deviceSession(workspace)
    const token = session.token
    const device = await keysService.device()
    const found = Letters.safeParse((await cloud.room({ method: 'GET', workspace, path: '/letters', token })).json).data?.data.find((each) => each.from === from && each.purpose === 'workspace-key')
    const plain = found && await openLetter({ found, workspace })
    const chain = await chainOf({ workspace, token })
    const secret = plain && readSecret(plain)
    const body = secret && chain[0] && await check({ anchor: secret.anchor, chain })
    if (!found || !secret || !body || !body.members.some((member) => member.email === email && member.devices.includes(toBase64(device.publicKey)))) throw new HttpError(400, 'This computer couldn’t join the workspace. Add it again from your Mac.')
    await cloud.room({ method: 'DELETE', workspace, path: `/letters/${found.id}`, token })
    await syncService.reset({ restoring: false })
    const { anchor: _anchor, ...keys } = secret
    await keysService.joinAsRuntime({ session, workspace: { id: workspace, ...keys }, chain })
    syncService.connect()
    return cloudService.status()
  },

  connect(): void {
    syncService.connect()
    checkSoon()
  },
}

export function mustBeOn(workspace: string): string {
  if (!keysService.session() || !roomKeys.room(workspace)) throw new HttpError(409, 'Enable OpenHut Cloud and open this workspace first.')
  return workspace
}

export async function putList({ workspace, list }: { workspace: string; list: MemberList }): Promise<void> {
  const put = await cloud.room({ method: 'PUT', workspace, path: '/members', token: await keysService.token(), body: list }).catch(() => ({ status: 0 }))
  if (put.status !== 200) throw await refusal({ ws: workspace, status: put.status })
  await roomKeys.advance({ lists: [list], ws: workspace })
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
  void roomKeys.post().catch(warnCheck)
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
  if (!await finishMoves(token).then(() => true, () => false)) {
    boxesDiffer = true
    return
  }
  const kit = await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })
  const workspaces = await cloud.account({ method: 'GET', path: '/v1/workspaces', token })
  if (![200, 404].includes(kit.status) || workspaces.status !== 200) return
  const cloudKit = await dropPending({ account, token, cloudKit: KeyBox.safeParse(kit.json).data })
  const mine = keysService.kitState().saved?.box
  const kitMine = cloudKit && await keysService.boxIsMine({ account, name: 'kit', box: cloudKit })
  const listed = Workspaces.safeParse(workspaces.json).data?.data ?? []
  const box = listed.find((each) => each.id === account.workspace.id)
  if (cloudKit && !kitMine && !box) return lockOut(account)
  const marker = cloudKit && kitMine ? await markerOf({ account, token, kit: cloudKit }) : undefined
  if (cloudKit && marker?.confirmed && cloudKit.body !== mine) await keysService.setKit({ box: cloudKit.body, savedAt: cloudKit.savedAt ?? new Date().toISOString() })
  if (marker && !marker.confirmed && mine && cloudKit?.body === mine) await confirmKit({ account, token, body: mine, savedAt: Math.max(Date.now(), marker.savedAt + 1) })
  if (cloudKit && !kitMine && mine) await keysService.setKit(undefined)
  const rebox = async (room: Room) => {
    const found = listed.find((each) => each.id === room.workspace.id)
    const mine = found && await keysService.boxIsMine({ account, room, name: `workspace/${room.workspace.id}`, box: { body: found.key, by: found.by, signature: found.signature } })
    return mine ? 200 : (await cloud.account({ method: 'POST', path: '/v1/workspaces', token, body: await keysService.workspaceBox({ account, room }) })).status
  }
  const reboxed = await rebox(account)
  for (const room of (account.teams ?? []).filter((each) => each.workspace.key)) await rebox(room)
  if (reboxed === 403 && !box) return lockOut(account)
  const passkey = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/passkey', token })).json).data
  passkeySaved = Boolean(passkey && await keysService.boxIsMine({ account, name: 'passkey', box: passkey }))
  const kitOk = cloudKit ? kitMine : !mine || (await cloud.account({ method: 'PUT', path: '/v1/key-boxes/kit', token, body: await keysService.signBox({ account, name: 'kit', body: mine, savedAt: Date.now() }) })).status === 200
  boxesDiffer = reboxed !== 200 || !kitOk
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
  syncService.disconnect()
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
  stopPairing()
  const token = await keysService.token()
  const joined = await cloud.room({ method: 'PUT', workspace: restored.workspace.id, path: '/members', token, body: restored.list })
  if (joined.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t add this computer. Try again.')
  const teams = []
  for (const team of restored.teams ?? []) if ((await cloud.room({ method: 'PUT', workspace: team.workspace.id, path: '/members', token, body: team.list })).status === 200) teams.push(team)
  const account = { ...restored, teams }
  const kit = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })).json).data
  const kept = kit && (typed || (await markerOf({ account, token, kit })).confirmed)
  await syncService.reset({ restoring: true })
  await keysService.adopt({ account, kit: kit && kept ? { box: kit.body, savedAt: kit.savedAt ?? new Date().toISOString() } : undefined })
  cloudService.connect()
  return cloudService.status()
}

async function checkPairing(): Promise<void> {
  const now = pairing
  if (!now) return
  if (Date.now() > Date.parse(now.reply.expiresAt) || !keysService.locked()) return stopPairing()
  const token = await keysService.token()
  for (const workspace of now.workspaces) {
    const got = await cloud.room({ method: 'GET', workspace, path: '/letters', token })
    if (got.status === 403) return removed()
    const found = Letters.safeParse(got.json).data?.data ?? []
    for (const each of found.filter((one) => one.purpose === 'pairing')) {
      const key = await keysService.readPairing({ secret: now.secret, workspace, found: each })
      const boxes = await boxesOf(token)
      const account = key && await keysService.restoreWith({ key, workspaces: [...boxes.filter((box) => box.id === workspace), ...boxes.filter((box) => box.id !== workspace)] })
      if (account && listedUnder({ account, device: each.from })) {
        await joinWith({ account, typed: false })
        return
      }
    }
  }
}

async function removed(): Promise<void> {
  stopPairing()
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
  await syncService.reset({ restoring: false })
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
  for (const { id: workspace } of keysService.asked().filter((each) => !now.settled.includes(each.id))) {
    const found = Letters.safeParse((await cloud.room({ method: 'GET', workspace, path: '/letters', token })).json).data?.data ?? []
    const chain = found.length ? await chainOf({ workspace, token }) : []
    const first = !keysService.account()
    if (found.length && await roomKeys.joinApproved({ ws: workspace, chain, found })) {
      for (const each of found) await cloud.room({ method: 'DELETE', workspace, path: `/letters/${each.id}`, token })
      now.settled.push(workspace)
      now.approved = true
      if (first) await syncService.reset({ restoring: true })
      cloudService.connect()
      continue
    }
    const mine = (Asked.safeParse((await cloud.room({ method: 'GET', workspace, path: '/requests', token })).json).data?.data ?? []).find((each) => each.device === me)
    if (!mine) now.settled.push(workspace)
    else if (mine.nonce && !await fixWords({ workspace, token, me, nonce: mine.nonce })) return askAgain()
  }
  if (now.settled.length < keysService.asked().length) return
  if (now.approved) return stopAsking()
  clearInterval(now.timer)
}

async function fixWords({ workspace, token, me, nonce }: { workspace: string; token: string; me: string; nonce: WordsNonce }): Promise<boolean> {
  const room = keysService.asked().find((each) => each.id === workspace)
  if (!room) return true
  if (room.nonce && room.nonce !== nonce.nonce) return false
  const fixed = room.nonce ? room : await firstNonce({ workspace, me, room, nonce })
  if (!fixed || fixed.revealed) return true
  const put = await cloud.room({ method: 'PUT', workspace, path: `/requests/${encodeURIComponent(me)}/reveal`, token, body: { reveal: fixed.secret } })
  if (put.status === 200) await saveRoom({ ...fixed, revealed: true })
  return true
}

async function firstNonce({ workspace, me, room, nonce }: { workspace: string; me: string; room: AskRoom; nonce: WordsNonce }): Promise<AskRoom | null> {
  const device = fromBase64(me)
  const reveal = fromBase64(room.secret)
  const commit = toBase64(await askCommit({ device, reveal }))
  if (!room.signers.includes(nonce.by) || !await checkProof({ device: nonce.by, proof: 'words', parts: [workspace, me, commit, nonce.nonce], signature: nonce.signature })) return null
  const fixed = { ...room, nonce: nonce.nonce, words: await deviceWords({ device, nonce: fromBase64(nonce.nonce), reveal }) }
  await saveRoom(fixed)
  return fixed
}

async function saveRoom(room: AskRoom): Promise<void> {
  await keysService.setAsked(keysService.asked().map((each) => each.id === room.id ? room : each))
}

async function askAgain(): Promise<void> {
  log.warn({ event: 'cloud.ask_nonce_changed' })
  await cloudService.ask()
  if (asking) asking.error = 'OpenHut Cloud changed the code behind your 4 words, so this Mac asked again with new words. Read your admin the new ones.'
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

function stopPairing(): void {
  clearInterval(pairing?.timer)
  pairing = undefined
}

async function rotate({ changed: { list, next, letters }, drop }: { changed: Awaited<ReturnType<typeof keysService.change>>; drop: ('kit' | 'kit-confirmed' | 'passkey')[] }): Promise<void> {
  const token = await keysService.token()
  await finishMoves(token)
  const moves: Move[] = [
    { method: 'POST', path: '/v1/workspaces', body: await keysService.workspaceBox({ account: next }) },
    ...await Promise.all(drop.map(async (kind): Promise<Move> => ({ method: 'DELETE', path: `/v1/key-boxes/${kind}`, body: await keysService.signBox({ account: next, name: `delete/${kind}`, body: '' }) }))),
  ]
  const put = await cloud.room({ method: 'PUT', workspace: next.workspace.id, path: '/members', token, body: list })
  if (put.status === 409) throw new HttpError(409, 'Your devices changed on another computer just now. Try again.')
  if (put.status !== 200) throw new HttpError(put.status === 403 ? 403 : 502, 'OpenHut Cloud couldn’t save the change. Try again.')
  await keysService.adopt({ account: next, moves })
  passkeySaved = false
  await roomKeys.post(letters.map((each) => ({ ...each, workspace: next.workspace.id })))
  syncService.refreshTeams()
  await finishMoves(token)
}

async function finishMoves(token: string): Promise<void> {
  const signer = await keysService.accountDeviceKey()
  for (const move of keysService.moves()) {
    const { status } = await cloud.account({ ...move, token }).catch(() => ({ status: 0 }))
    const stale = (status === 403 || status === 409) && z.safeParse(z.object({ by: z.string() }), move.body).data?.by !== signer
    boxesDiffer = status !== 200 && !(status === 404 && move.method === 'DELETE') && !stale
    if (boxesDiffer) throw new HttpError(502, 'Your recovery kit isn’t updated in OpenHut Cloud yet. OpenHut tries again every minute, or you can make a new kit.')
    await keysService.setMoves(keysService.moves().slice(1))
  }
}

function page(sentence: string): string {
  const text = sentence.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenHut</title><body style="margin:0;display:grid;place-items:center;min-height:90vh;font:15px/1.5 -apple-system,system-ui,sans-serif;color:#0b0b0b;background:#fff"><p style="max-width:420px;padding:0 16px;text-align:center">${text}</p></body>`
}

async function openRoom({ account, token }: { account: Account; token: string }): Promise<boolean> {
  const workspace = account.workspace.id
  const boxed = await cloud.account({ method: 'POST', path: '/v1/workspaces', token, body: await keysService.workspaceBox({ account }) })
  if (boxed.status === 403) return false
  const found = await cloud.room({ method: 'GET', workspace, path: '/members', token })
  if (found.status === 200) return true
  const made = found.status === 404 ? await cloud.room({ method: 'PUT', workspace, path: '/members', token, body: account.list }) : found
  if (made.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t open this workspace. Try again.')
  return true
}

async function teamsOf(token: string): Promise<{ id: string }[]> {
  return Teams.safeParse((await cloud.account({ method: 'GET', path: '/v1/teams', token })).json).data?.data ?? []
}

async function notNew(ws: string): Promise<void> {
  const body = roomKeys.members(ws)
  const until = body ? newUntil(body, await keysService.deviceKey()) : 0
  if (until > Date.now()) throw new HttpError(403, `This computer was added less than 3 days ago, so it can’t delete a workspace yet. Do it from an older one, or wait until ${new Date(until).toLocaleDateString('en', { month: 'short', day: 'numeric' })}.`)
}

async function keepToRotate(): Promise<void> {
  const value = JSON.stringify((await connectionService.synced()).map(({ id, name, kind }) => ({ id, name, kind })))
  await db.insertInto('install_setting').values({ name: ROTATE, value }).onConflict((oc) => oc.column('name').doUpdateSet({ value })).execute()
}

async function toRotate(): Promise<Cloud['rotate']> {
  const row = await db.selectFrom('install_setting').select('value').where('name', '=', ROTATE).executeTakeFirst()
  return z.safeParse(Rotate, JSON.parse(row?.value ?? '[]')).data ?? []
}
