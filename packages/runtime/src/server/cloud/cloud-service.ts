import { randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import * as z from 'zod/mini'
import { type Backup, KeyBox, Letter, MemberList, type Role, type Cloud, type CloudAuthorization, type RecoveryKit, type UnlockCloud, faceName, siteHost } from '@openhut/common/cloud/cloud.ts'
import type { Health } from '@openhut/common/admin/admin.ts'
import { JoinCode, Me, signV1 } from '@openhut/common/cloud/v1/identity.ts'
import { JoinRequest } from '@openhut/common/cloud/v1/trust.ts'
import { commitOf, facesOf } from '@openhut/common/cloud/faces.ts'
import { addedOf, bodyOf, nextOf, signList, withoutDevices } from '@openhut/common/cloud/member-list.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/vault.ts'
import { kitId } from '@openhut/common/vault/kit-file.ts'
import { cloud, type Box, type Letter as Sealed, type Reply } from '../platform/cloud.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { page } from '../platform/page.ts'
import { settings } from '../platform/settings.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { callbackBase, connectionService } from '../connections/connection-service.ts'
import { keyStore, type Account, type AskRoom } from './key-store.ts'
import { deviceName, deviceOs, keysService, openLetter, sealTo } from './keys-service.ts'
import { roomKeys } from './room-keys.ts'
import { guessSite, teamIcon } from './team-icon.ts'
import { hinted, takeSignIn, withSignIn } from './sign-ins.ts'
import { BEAT_MS, cloudEvents } from './cloud-events.ts'
import { recordsService } from './records.ts'
import { agentService } from '../agents/agent-service.ts'

const CHECK_MS = 60_000
const Boxes = z.object({ data: z.array(z.object({ id: z.string(), body: z.string(), by: z.string(), signature: z.string() })) })
const WORKSPACE_BOX = 'workspace-'
const Newer = z.object({ data: z.array(z.unknown()) })
const IDLE: Backup = { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null }
const CHANGED = 'Someone changed this team a moment ago. Try again.'
const Lists = z.object({ data: z.array(MemberList), hasMore: z.optional(z.boolean()) })
const Letters = z.object({ data: z.array(Letter) })
const Asked = z.object({ data: z.array(JoinRequest) })
const ROTATE = 'cloud_rotate'
const ASK_POLL_MS = 2000
let signInError: string | null = null
let boxesDiffer = false
let checkedAt = 0
let cloudHasKit: boolean | undefined
let boxes: Promise<unknown> = Promise.resolve()
let passkeySaved = false
let passkeyDropped = false
let asking: { settled: string[]; approved: boolean; error: string | null; timer: NodeJS.Timeout; reviewed: boolean; revealed: boolean; missed: boolean } | undefined
let polling = false
let joinError: string | null = null
const Rotate = z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() }))

export const cloudService = {
  async status(): Promise<Cloud> {
    const account = keysService.account()
    const session = keysService.session()
    const on = Boolean(account && session)
    const members = roomKeys.members()
    const locked = !account ? keysService.locked() : undefined
    if (on && Date.now() - checkedAt > CHECK_MS) checkSoon()
    if (on && cloudHasKit === undefined && !keysService.kitState().saved) cloudHasKit = await cloudBox('kit').then((got) => got.status === 200, () => undefined)
    const here = await keysService.deviceKey()
    const lists = on && account ? roomKeys.rooms().map((room) => roomKeys.members(room.workspace.id)) : []
    const accountKey = await keysService.accountDeviceKey()
    const asked = locked ? resumeAsking() : undefined
    const askRooms = keysService.asked()
    const [inCloud, passkeyInCloud] = locked && session ? await Promise.all([kitInCloud(), boxInCloud('passkey')]) : [null, false]
    const devices = lists.flatMap((body) => {
      const mine = body?.members.find((member) => member.email === account?.email)
      return body && mine ? mine.devices.filter((key) => key !== mine.kit && key !== accountKey).map((key) => ({ key, here: key === here, addedAt: addedOf(body, key) ? new Date(addedOf(body, key)).toISOString() : null, name: body.names?.[key] ?? null, kind: body.runtimes?.includes(key) ? 'server' as const : 'mac' as const, online: key === here || Date.now() - (cloudEvents.beats(body.workspace).get(key)?.at ?? 0) < 3 * BEAT_MS })) : []
    }).filter(({ key }, index, all) => all.findIndex((each) => each.key === key) === index).sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))
    return {
      object: 'cloud', status: locked ? 'locked' : on ? (cloudEvents.ready() ? 'on' : 'offline') : 'off', email: locked?.email ?? (on && account ? account.email : null),
      device: here,
      workspace: on && account && members ? { id: account.workspace.id, version: members.version, members: members.members } : null,
      keyStore: keyStore.kind(), kit: on ? kitOf() : null, kitInCloud: inCloud ? inCloud.found : Boolean(keysService.kitState().saved) || cloudHasKit === true, cloudKit: inCloud?.kit ?? null, backup: IDLE,
      signInError, keptAccount: on ? null : (keysService.kitState().saved ? keysService.account()?.email ?? null : null), devices, passkey: on ? passkeySaved : passkeyInCloud, touchIdOff: on && passkeyDropped && !passkeySaved, youngUntil: null, needsSignIn: Boolean(locked && !session),
      workspaces: on && account ? roomKeys.rooms().map(({ workspace: { id, key } }) => {
        const body = roomKeys.members(id)
        const invites = (body?.invites ?? []).map((each) => ({ email: each.email, role: each.role, link: roomKeys.link({ ws: id, email: each.email }) ?? null }))
        return { id, name: cloudEvents.name(id), website: cloudEvents.site(id), home: id === account.workspace.id, own: roomKeys.isOwn(id), role: roomKeys.roleIn(id) ?? 'member', waiting: !key, members: body?.members ?? [], invites, requests: cloudEvents.requests(id), names: body?.names ?? {} }
      }) : [],
      asking: asked ? { rooms: askRooms.filter((room) => !asked.settled.includes(room.id)).map(({ admins, own }) => ({ admins, own: Boolean(own) })), denied: asked.settled.length === askRooms.length, error: asked.error, name: deviceName(), reviewed: asked.reviewed, missed: asked.missed, faces: asked.revealed && askRooms[0]?.nonce ? facesOf({ device: here, nonce: askRooms[0].nonce }) : null } : null,
      canAsk: Boolean(locked && session),
      rotate: on ? await toRotate() : [],
      gone: cloudEvents.gone(),
    }
  },

  async ask(): Promise<Cloud> {
    const { email } = mustBeLocked()
    await stopAsking()
    const teams = await teamsOf()
    const own = (await boxesOf()).filter((box) => !teams.includes(box.id))
    const nonce = randomBytes(32).toString('base64url')
    const commit = commitOf({ device: await keysService.deviceKey(), nonce })
    const rooms: AskRoom[] = []
    let refused: string | null = null
    let waiting = false
    for (const { id, chain } of [...own, ...await Promise.all(teams.map(async (id) => ({ id, chain: await chainOf(id) })))]) {
      const body = bodyOf(chain.at(-1))
      const me = body?.members.find((member) => member.email === email)
      const home = !teams.includes(id) && me?.role === 'owner'
      const approvers = home
        ? [me].filter((member) => member.devices.some((device) => device !== member.kit && !body?.runtimes?.includes(device)))
        : body?.members.filter((member) => member.role !== 'member' && member.email !== email) ?? []
      if (!approvers.length) continue
      const asked = await keysService.call({ method: 'POST', path: '/v1/join-requests', body: { workspace: id, name: deviceName(), os: deviceOs(), server: !config.personal, commit } })
      waiting ||= asked.status === 409
      if (asked.status !== 200) refused = z.safeParse(z.object({ error: z.object({ message: z.string() }) }), asked.json).data?.error.message ?? 'OpenHut Cloud couldn’t send your request. Try again.'
      if (asked.status !== 200) continue
      rooms.push({ id, admins: approvers.map((member) => member.email), own: home, nonce })
    }
    if (!rooms.length) throw new HttpError(409, refused ?? 'None of your other computers or team admins can let this computer in. Use your recovery kit.', waiting ? { param: 'waiting' } : undefined)
    await keysService.setAsked(rooms)
    resumeAsking()
    return cloudService.status()
  },

  async cancelAsk(): Promise<Cloud> {
    const rooms = keysService.asked()
    await stopAsking()
    const me = encodeURIComponent(await keysService.deviceKey())
    for (const { id: workspace } of rooms) await keysService.call({ method: 'DELETE', path: `/v1/join-requests/${me}?workspace=${workspace}` }).catch(() => undefined)
    return cloudService.status()
  },

  async review({ workspace, device }: { workspace: string; device: string }): Promise<Cloud> {
    const reviewed = await keysService.call({ method: 'POST', path: `/v1/join-requests/${encodeURIComponent(device)}/reviews?workspace=${mustBeOn(workspace)}` })
    if (reviewed.status !== 200) throw new HttpError(reviewed.status === 404 ? 404 : 502, reviewed.status === 404 ? 'That device isn’t waiting anymore. It was let in, denied, or it expired.' : 'OpenHut Cloud couldn’t open the request. Try again.')
    await cloudEvents.refreshRequests(workspace)
    return cloudService.status()
  },

  async approve({ workspace, device, faces }: { workspace: string; device: string; faces?: number[] }): Promise<Cloud> {
    const asked = cloudEvents.requests(mustBeOn(workspace)).find((each) => each.device === device)
    if (!asked) throw new HttpError(404, 'That device isn’t waiting anymore. It was let in, denied, or it expired.')
    if (asked.checked && (!asked.faces || [...faces ?? []].sort((a, b) => a - b).join() !== asked.faces.join())) throw new HttpError(400, 'Those faces don’t match the ones on the new computer.', { param: 'faces' })
    const mine = roomKeys.isOwn(workspace) && asked.email === keysService.account()?.email
    if (mine && !asked.server) {
      const sent = await keysService.call({ method: 'POST', path: '/v1/letters', body: { workspace, ...await keysService.accountLetter(device) } })
      if (sent.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t let that computer in. Try again.')
      return cloudService.status()
    }
    const approved = mine ? await serverApproval({ device, name: asked.name }) : await roomKeys.approve({ ws: workspace, email: asked.email, device, name: asked.name })
    await putList({ workspace, list: approved.list, letters: [approved.letter] })
    await cloudEvents.refreshRequests(workspace)
    return cloudService.status()
  },

  async deny({ workspace, device, why }: { workspace: string; device: string; why?: 'mismatch' | 'not-me' }): Promise<Cloud> {
    const denied = await keysService.call({ method: 'DELETE', path: `/v1/join-requests/${encodeURIComponent(device)}?workspace=${mustBeOn(workspace)}${why ? `&why=${why}` : ''}` })
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

  async deleteData(): Promise<Cloud> {
    if (keysService.locked() && !keysService.account()) return await deleteLocked()
    const account = keysService.mustBeOn()
    const teams = roomKeys.rooms().map((room) => room.workspace.id).filter((ws) => ws !== account.workspace.id)
    for (const ws of teams) await change({ ws, emails: [account.email] }).catch((err: unknown) => log.warn({ event: 'cloud.leave_failed', error: messageOf(err) }))
    cloudEvents.stop()
    const wiped = await keysService.call({ method: 'DELETE', path: '/v1/account' })
    if (wiped.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t delete your account. Try again.')
    await keysService.forgetHere()
    return cloudService.status()
  },

  async update({ workspace, name, website }: { workspace: string; name?: string; website?: string | null }): Promise<Cloud> {
    const ws = mustBeOn(workspace)
    const site = website === null ? '' : website && siteHost(website)
    if (site === null) throw new HttpError(400, 'Enter a website like example.com.', { param: 'website' })
    if (name === undefined && site === undefined) return cloudService.status()
    if (roomKeys.roleIn(ws) === 'member') throw new HttpError(403, `Only an owner or admin can ${name === undefined ? 'change the website of' : 'rename'} the team.`)
    const kept = { name: cloudEvents.named(ws), site: cloudEvents.site(ws) }
    const value = { name: name ?? kept.name, site: site === undefined ? kept.site : site || null }
    await recordsService.put({ collection: 'workspace', id: ws, workspace: ws, value, reapply: (current) => ({ value: { ...z.safeParse(z.record(z.string(), z.unknown()), current.value).data, ...name !== undefined && { name }, ...site !== undefined && { site: site || null } } }) })
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

  async start({ loginHint }: { loginHint?: string } = {}): Promise<CloudAuthorization> {
    const device = await keysService.device()
    const state = randomBytes(24).toString('base64url')
    const { url } = await cloud.signIn({ provider: 'google', device: toBase64(device.publicKey), redirectUrl: `${callbackBase()}/api/cloud/callback`, state })
    await settings.setSignIns(withSignIn({ pending: settings.signIns(), state, now: Date.now() }))
    signInError = null
    return { object: 'cloud_authorization', authorizationUrl: hinted({ url, loginHint }) }
  },

  async finish({ state, code, error }: { state?: string; code?: string; error?: string }): Promise<string> {
    const { started, rest } = takeSignIn({ pending: settings.signIns(), state: state ?? '', now: Date.now() })
    await settings.setSignIns(rest)
    if (!started) return page('This sign-in expired. Go back to OpenHut and try again.')
    if (!code) {
      signInError = error ? 'Sign-in was cancelled.' : 'Google didn’t finish the sign-in. Try again.'
      return page(`${signInError} You can go back to OpenHut.`)
    }
    try {
      const device = await keysService.device()
      const session = await cloud.session({ grant: 'google', code, signature: await signV1({ signer: device, proof: 'session', parts: [code] }) })
      keysService.ownedBy(session)
      await keysService.setSession({ token: session.token, refresh: session.refresh, expiresAt: session.expiresAt })
      const who = { sub: session.sub, email: session.email }
      if (keysService.account()?.sub !== session.sub) {
        if (await accountExists()) {
          log.info({ event: 'cloud.locked', why: 'this account already has a team or a kit' })
          await keysService.setLocked(who)
          return signedIn(session.email)
        }
      }
      const me = Me.safeParse((await keysService.call({ method: 'GET', path: '/v1/me' })).json).data
      if (!me?.home) throw new HttpError(502, 'OpenHut Cloud didn’t send your home team. Try again.')
      const home = me.home
      const opened = await serial(async () => openRoom({ account: await keysService.open({ ...who, home }) }))
      if (!opened) {
        await keysService.relock(who)
        return signedIn(session.email)
      }
      cloudService.connect()
      return signedIn(session.email)
    } catch (err) {
      signInError = messageOf(err)
      return page(`${signInError} Go back to OpenHut.`)
    }
  },

  async signOut(): Promise<Cloud> {
    await stopAsking()
    if (keysService.account()?.key && keysService.session()) await leaveHere().catch((err: unknown) => log.warn({ event: 'cloud.leave_failed', error: messageOf(err) }))
    await keysService.setSession(undefined)
    await keysService.setLocked(undefined)
    cloudEvents.stop()
    signInError = null
    cloudHasKit = undefined
    return cloudService.status()
  },

  async newKit(): Promise<RecoveryKit> {
    return serial(async () => {
      keysService.mustBeOn()
      if (keysService.kitState().saved) await rotate({ changed: await keysService.change(), drop: ['passkey'] })
      const { words, box, ask } = await keysService.newKit()
      const kept = boxIn(await getBox('kit'))
      if (kept && !keysService.kitState().saved) throw new HttpError(409, 'Your account already has a recovery kit, and this computer hasn’t picked it up yet. Use the kit you saved, or make a new one on the computer that made it.')
      const savedAt = Math.max(Date.now(), (Date.parse(kept?.savedAt ?? '') || 0) + 1)
      await keysService.setKit({ box, savedAt: new Date(savedAt).toISOString(), confirmed: false })
      const signer = keysService.mustBeOn()
      try {
        const saved = await keysService.call({ method: 'PUT', path: '/v1/key-boxes/kit', body: await keysService.signBox({ account: signer, name: 'kit', body: box, savedAt }) })
        boxesDiffer = saved.status === 403
        if (saved.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t save your recovery kit. Try again.')
      } catch (err) {
        await getBox('kit').then((got) => dropPending({ account: signer, cloudKit: boxIn(got) })).catch(warnCheck)
        throw err
      }
      await keysService.setKit({ box, savedAt: new Date(savedAt).toISOString() })
      cloudHasKit = true
      await confirmKit({ account: signer, body: box, savedAt }).catch(warnCheck)
      return { object: 'recovery_kit' as const, words, ask, kitId: await kitId(box), madeAt: new Date(savedAt).toISOString(), device: deviceName() }
    })
  },

  async unlock(body: UnlockCloud): Promise<Cloud> {
    mustBeLocked()
    const kind = 'words' in body ? 'kit' : 'passkey'
    const box = boxIn(await getBox(kind))
    if (!box && kind === 'kit') throw new HttpError(409, `There’s no recovery kit for this account yet. Save one on the computer you set up first, then type its words here.`)
    if (!box) throw new HttpError(409, `Touch ID isn’t set up for this account yet. Turn it on in Settings › General on a Mac that’s already unlocked.`)
    const workspaces = await boxesOf()
    const account = 'words' in body
      ? await keysService.restore({ words: body.words, kit: box.body, workspaces })
      : await keysService.fromPasskey({ prf: fromBase64(body.prf), box: box.body }).then((key) => key && keysService.restoreWith({ key, workspaces }))
    if (!account && 'words' in body) throw new HttpError(400, 'Those aren’t the words of your recovery kit. Check each word and try again.', { param: 'words' })
    if (!account) throw new HttpError(400, `Touch ID isn’t set up on this Mac. Unlock another way.`)
    return joinWith({ account, typed: 'words' in body })
  },

  async addPasskey({ prf }: { prf: string }): Promise<Cloud> {
    const saved = await keysService.call({ method: 'PUT', path: '/v1/key-boxes/passkey', body: await keysService.passkeyBox(fromBase64(prf)) })
    boxesDiffer ||= saved.status === 403
    if (saved.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t save Touch ID. Try again.')
    passkeySaved = true
    passkeyDropped = false
    return cloudService.status()
  },

  async removePasskey(): Promise<Cloud> {
    const account = keysService.mustBeOn()
    if (!await serial(() => deleteBoxes({ account, kinds: ['passkey'] }))) throw new HttpError(502, 'OpenHut Cloud couldn’t turn Touch ID off. Try again.')
    passkeySaved = false
    return cloudService.status()
  },

  async notMe({ device }: { device: string }): Promise<Cloud> {
    const account = keysService.mustBeOn()
    const mine = (ws: string) => Boolean(roomKeys.members(ws)?.members.some((member) => member.email === account.email && member.devices.includes(device)))
    const teams = roomKeys.rooms().map((room) => room.workspace.id).filter((ws) => ws !== account.workspace.id && mine(ws))
    if (!mine(account.workspace.id) && !teams.length) throw new HttpError(400, 'Pick one of your other devices to remove.', { param: 'device' })
    if (mine(account.workspace.id)) await serial(async () => putList({ workspace: account.workspace.id, list: await keysService.dropDevices([device]) }))
    for (const ws of teams) await change({ ws, devices: [device] })
    if (await serial(() => deleteBoxes({ account, kinds: ['passkey'] }))) passkeySaved = false
    await keepToRotate()
    return cloudService.status()
  },

  async joinCode(): Promise<JoinCode> {
    keysService.mustBeOn()
    const made = await keysService.call({ method: 'POST', path: '/v1/join-codes' })
    const code = JoinCode.safeParse(made.json).data
    if (!code) throw new HttpError(502, 'OpenHut Cloud couldn’t make a join code. Try again.')
    return code
  },

  async joining(): Promise<Health['join']> {
    if (!config.join) return undefined
    if (keysService.account()) return { state: 'joined', error: null }
    if (joinError) return { state: 'failed', error: joinError }
    const rooms = keysService.asked()
    if (!rooms.length) return { state: 'starting', error: null }
    if (asking && !asking.approved && asking.settled.length >= rooms.length) return { state: 'denied', error: null }
    const nonce = asking?.revealed ? rooms[0]?.nonce : undefined
    return { state: 'asking', error: null, ...nonce && { faces: facesOf({ device: await keysService.deviceKey(), nonce }).map(faceName) } }
  },

  async rotated(): Promise<Cloud> {
    await db.deleteFrom('install_setting').where('name', '=', ROTATE).execute()
    return cloudService.status()
  },

  connect(): void {
    if (config.join && !keysService.account()) void joinAsServer(config.join).catch((err: unknown) => {
      joinError = messageOf(err)
      log.error({ event: 'cloud.join_failed', error: joinError })
    })
    cloudEvents.start()
    checkSoon()
  },
}

export function mustBeOn(workspace: string): string {
  if (!keysService.session() || !roomKeys.room(workspace)) throw new HttpError(409, 'Enable OpenHut Cloud and open this team first.')
  return workspace
}

export async function putList({ workspace, list, letters, boxes }: { workspace: string; list: MemberList; letters?: Sealed[]; boxes?: Box[] }): Promise<void> {
  const put = await keysService.memberLists({ list, letters, boxes }).catch(() => ({ status: 0 }))
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
  const newer = await keysService.call({ method: 'GET', path: `/v1/member-lists?workspace=${ws}&startingAfter=${roomKeys.members(ws)?.version ?? 0}` }).catch(() => null)
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

function signedIn(email: string): string {
  return page(`Signed in as ${email}. OpenHut has moved on, so you can close this tab.`, { title: 'Done', tab: 'Signed in', back: config.appScheme && `${config.appScheme}://open` })
}

function kitOf(): { savedAt: string; differs: boolean } | null {
  const kit = keysService.kitState().saved
  return kit || boxesDiffer ? { savedAt: kit?.savedAt ?? new Date(0).toISOString(), differs: boxesDiffer } : null
}

async function accountExists(): Promise<boolean> {
  const me = Me.safeParse((await keysService.call({ method: 'GET', path: '/v1/me' })).json).data
  if (!me) throw new HttpError(502, 'OpenHut Cloud couldn’t check for a backup. Try again.')
  return me.workspaces.length > 0 || (await getBox('kit')).status === 200
}

async function getBox(name: string): Promise<Reply> {
  return keysService.call({ method: 'GET', path: `/v1/key-boxes/${name}` }).catch(() => ({ status: 0, json: null }))
}

function boxIn(reply: Reply): KeyBox | undefined {
  const json = reply.status === 200 && typeof reply.json === 'object' && reply.json ? reply.json : null
  return json && 'id' in json ? KeyBox.safeParse({ ...json, kind: json.id }).data : undefined
}

async function cloudBox(kind: 'kit' | 'passkey'): Promise<Reply> {
  return getBox(kind)
}

async function boxInCloud(kind: 'kit' | 'passkey'): Promise<boolean> {
  return (await cloudBox(kind)).status !== 404
}

async function kitInCloud(): Promise<{ found: boolean; kit: { id: string; savedAt: string | null } | null }> {
  const got = await cloudBox('kit')
  const box = boxIn(got)
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
  const kit = await getBox('kit')
  const workspaces = await keysService.call({ method: 'GET', path: '/v1/key-boxes' })
  if (![200, 404].includes(kit.status) || workspaces.status !== 200) return
  if (!Boxes.safeParse(workspaces.json).data?.data.some((each) => each.id === `${WORKSPACE_BOX}${account.workspace.id}`)) return lockOut(account)
  const cloudKit = await dropPending({ account, cloudKit: boxIn(kit) })
  cloudHasKit = Boolean(cloudKit)
  const mine = keysService.kitState().saved?.box
  const kitMine = Boolean(cloudKit && await keysService.boxIsMine({ account, name: 'kit', box: cloudKit }))
  const marker = cloudKit && kitMine ? await markerOf({ account, kit: cloudKit }) : undefined
  if (cloudKit && marker?.confirmed && cloudKit.body !== mine) await keysService.setKit({ box: cloudKit.body, savedAt: cloudKit.savedAt ?? new Date().toISOString() })
  if (marker && !marker.confirmed && mine && cloudKit?.body === mine) await confirmKit({ account, body: mine, savedAt: Math.max(Date.now(), marker.savedAt + 1) })
  if (cloudKit && !kitMine && mine) await keysService.setKit(undefined)
  const passkey = boxIn(await getBox('passkey'))
  passkeySaved = Boolean(passkey && await keysService.boxIsMine({ account, name: 'passkey', box: passkey }))
  boxesDiffer = Boolean(cloudKit && !kitMine)
}

async function dropPending({ account, cloudKit }: { account: Account; cloudKit: KeyBox | undefined }): Promise<KeyBox | undefined> {
  const pending = keysService.kitState().pending
  if (!pending) return cloudKit
  if (cloudKit?.body === pending && !await deleteBoxes({ account, kinds: ['kit', 'kit-confirmed'] })) return cloudKit
  await keysService.setKit(undefined)
  return cloudKit?.body === pending ? undefined : cloudKit
}

async function markerOf({ account, kit }: { account: Account; kit: KeyBox }): Promise<{ confirmed: boolean; savedAt: number }> {
  const marker = boxIn(await getBox('kit-confirmed'))
  return { confirmed: Boolean(marker && marker.body === kit.body && await keysService.boxIsMine({ account, name: 'kit-confirmed', box: marker })), savedAt: Date.parse(marker?.savedAt ?? '') || 0 }
}

async function confirmKit({ account, body, savedAt }: { account: Account; body: string; savedAt: number }): Promise<void> {
  await keysService.call({ method: 'PUT', path: '/v1/key-boxes/kit-confirmed', body: await keysService.signBox({ account, name: 'kit-confirmed', body, savedAt }) })
}

async function deleteBoxes({ account, kinds }: { account: Account; kinds: string[] }): Promise<boolean> {
  let deleted = true
  for (const kind of kinds) {
    const gone = await keysService.call({ method: 'DELETE', path: `/v1/key-boxes/${kind}`, body: await keysService.deleteBox({ account, name: kind }) })
    deleted &&= gone.status === 200 || gone.status === 404
  }
  return deleted
}

async function lockOut({ sub, email }: Account): Promise<void> {
  cloudEvents.stop()
  await keysService.relock({ sub, email })
  boxesDiffer = false
}

async function boxesOf(): Promise<{ id: string; key: string; chain: MemberList[] }[]> {
  const listed = Boxes.safeParse((await keysService.call({ method: 'GET', path: '/v1/key-boxes' })).json).data?.data ?? []
  const boxes = listed.filter((box) => box.id.startsWith(WORKSPACE_BOX)).map((box) => ({ id: box.id.slice(WORKSPACE_BOX.length), key: box.body }))
  return Promise.all(boxes.map(async (box) => ({ ...box, chain: await chainOf(box.id) })))
}

async function chainOf(workspace: string): Promise<MemberList[]> {
  const chain: MemberList[] = []
  for (let more = true; more;) {
    const page = Lists.safeParse((await keysService.call({ method: 'GET', path: `/v1/member-lists?workspace=${workspace}&startingAfter=${bodyOf(chain.at(-1))?.version ?? 0}` })).json).data
    chain.push(...page?.data ?? [])
    more = Boolean(page?.hasMore && page.data.length)
  }
  return chain
}

async function joinWith({ account: restored, typed }: { account: Account; typed: boolean }): Promise<Cloud> {
  const joined = await keysService.memberLists({ list: restored.list })
  if (joined.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t add this computer. Try again.')
  const teams = []
  for (const team of restored.teams ?? []) if ((await keysService.memberLists({ list: team.list })).status === 200) teams.push(team)
  const account = { ...restored, teams }
  const kit = boxIn(await getBox('kit'))
  const kept = kit && (typed || (await markerOf({ account, kit })).confirmed)
  await keysService.adopt({ account, kit: kit && kept ? { box: kit.body, savedAt: kit.savedAt ?? new Date().toISOString() } : undefined })
  cloudService.connect()
  return cloudService.status()
}

async function leaveHere(): Promise<void> {
  if (!await recordsService.sent()) throw new HttpError(409, 'Your agents aren’t backed up yet. Sign out once this computer is online and the backup is done, so nothing is lost.')
  await dropHere()
  cloudEvents.stop()
  await agentService.wipe()
  await connectionService.wipe()
  await keysService.forgetHere()
}

async function dropHere(): Promise<void> {
  const me = await keysService.deviceKey()
  const signer = await keysService.device()
  for (const room of roomKeys.rooms()) {
    const body = bodyOf(room.list)
    if (!body?.members.some((member) => member.devices.includes(me))) continue
    const list = await signList({ signer, body: withoutDevices({ body: await nextOf({ list: room.list, body, me }), gone: [me] }) })
    await putList({ workspace: room.workspace.id, list })
  }
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
  const wiped = await keysService.call({ method: 'DELETE', path: '/v1/account' })
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
  const me = await keysService.deviceKey()
  for (const { id: workspace, own, nonce } of keysService.asked().filter((each) => !now.settled.includes(each.id))) {
    const got = await keysService.call({ method: 'GET', path: `/v1/letters?workspace=${workspace}` })
    if (got.status === 403 && own) return removed()
    const found = Letters.safeParse(got.json).data?.data ?? []
    if (own && await unlockedBy({ workspace, found })) return
    const chain = (!own || !config.personal) && found.length ? await chainOf(workspace) : []
    if (chain.length && await roomKeys.joinApproved({ ws: workspace, chain, found })) {
      for (const each of found) await keysService.call({ method: 'DELETE', path: `/v1/letters/${each.id}` })
      now.settled.push(workspace)
      now.approved = true
      cloudService.connect()
      continue
    }
    const mine = (Asked.safeParse((await keysService.call({ method: 'GET', path: `/v1/join-requests?workspace=${workspace}` })).json).data?.data ?? []).find((each) => each.id === me)
    now.reviewed ||= Boolean(mine?.reviewed)
    now.missed ||= Boolean(mine?.missed && !mine.asked)
    if (mine?.reviewed && mine.commit && !mine.nonce && nonce) now.revealed = (await keysService.call({ method: 'POST', path: '/v1/join-requests/nonces', body: { workspace, nonce } })).status === 200 || now.revealed
    if (mine?.nonce) now.revealed = true
    if (!mine?.asked) now.settled.push(workspace)
  }
  if (now.settled.length < keysService.asked().length) return
  if (now.approved) return stopAsking()
  clearInterval(now.timer)
}

async function unlockedBy({ workspace, found }: { workspace: string; found: Letter[] }): Promise<boolean> {
  for (const each of found.filter((one) => one.purpose === 'account-key')) {
    const key = await openLetter({ found: each, workspace })
    const boxes = key ? await boxesOf() : []
    const account = key && await keysService.restoreWith({ key, workspaces: [...boxes.filter((box) => box.id === workspace), ...boxes.filter((box) => box.id !== workspace)] })
    if (!account || !listedUnder({ account, device: each.from })) continue
    await joinWith({ account, typed: false })
    await keysService.call({ method: 'DELETE', path: `/v1/letters/${each.id}` }).catch(() => undefined)
    await stopAsking()
    return true
  }
  return false
}

function resumeAsking(): typeof asking {
  if (!asking && keysService.session() && keysService.asked().length) asking = { settled: [], approved: false, error: null, timer: setInterval(pollAsked, ASK_POLL_MS), reviewed: false, revealed: false, missed: false }
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
  const boxes: Box[] = await Promise.all([next, ...(next.teams ?? []).filter((each) => each.workspace.key)].map((room) => keysService.workspaceBox({ account: next, room })))
  const put = await keysService.memberLists({ list, letters, boxes })
  if (put.status === 409) throw new HttpError(409, 'Your devices changed on another computer just now. Try again.')
  if (put.status !== 200) throw new HttpError(put.status === 403 ? 403 : 502, 'OpenHut Cloud couldn’t save the change. Try again.')
  await keysService.adopt({ account: next })
  await deleteBoxes({ account: next, kinds: drop })
  passkeyDropped ||= passkeySaved && drop.includes('passkey')
  passkeySaved = false
  for (const team of next.teams ?? []) await cloudEvents.refreshKeys(team.workspace.id)
}


async function openRoom({ account }: { account: Account }): Promise<boolean> {
  const made = await keysService.memberLists({ list: account.list, boxes: [await keysService.workspaceBox({ account })] })
  if (made.status === 403) {
    log.warn({ event: 'cloud.room_refused', workspace: account.workspace.id, reply: JSON.stringify(made.json).slice(0, 300) })
    return false
  }
  if (made.status !== 200 && made.status !== 409) throw new HttpError(502, 'OpenHut Cloud couldn’t open this team. Try again.')
  return true
}

async function teamsOf(): Promise<string[]> {
  const me = Me.safeParse((await keysService.call({ method: 'GET', path: '/v1/me' })).json).data
  return me?.workspaces.map((each) => each.id).filter((id) => id !== me.home) ?? []
}

async function keepToRotate(): Promise<void> {
  const value = JSON.stringify(await connectionService.rotatable())
  await db.insertInto('install_setting').values({ name: ROTATE, value }).onConflict((oc) => oc.column('name').doUpdateSet({ value })).execute()
}

async function toRotate(): Promise<Cloud['rotate']> {
  const row = await db.selectFrom('install_setting').select('value').where('name', '=', ROTATE).executeTakeFirst()
  return z.safeParse(Rotate, JSON.parse(row?.value ?? '[]')).data ?? []
}
