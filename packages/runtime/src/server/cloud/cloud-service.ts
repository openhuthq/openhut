import { randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import * as z from 'zod/mini'
import { type Backup, type Letter, type MemberList, type Role, type Cloud, type CloudAuthorization, KNOCK_MS, siteHost } from '@openhut/common/cloud/cloud.ts'
import type { Health } from '@openhut/common/admin/admin.ts'
import type { JoinCode } from '@openhut/common/cloud/v1/identity.ts'
import { addedOf, bodyOf } from '@openhut/common/cloud/member-list.ts'
import { CloudError } from '@openhut/common/cloud/openhut-cloud.ts'
import { cloud, fromCloud, sending } from '../platform/cloud.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { page } from '../platform/page.ts'
import { settings } from '../platform/settings.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { callbackBase, connectionService } from '../connections/connection-service.ts'
import { keyStore, type Account, type AskRoom } from './key-store.ts'
import { keyring } from '@openhut/common/keyring/keyring.ts'
import { deviceName, deviceOs, keysService, type Box, type Sent as Sealed } from './keys-service.ts'
import { roomKeys } from './room-keys.ts'
import { guessSite, teamIcon } from './team-icon.ts'
import { hinted, takeSignIn, withSignIn } from './sign-ins.ts'
import { BEAT_MS, cloudEvents } from './cloud-events.ts'
import { recordsService } from './records.ts'
import { agentService } from '../agents/agent-service.ts'

const CHECK_MS = 60_000
const WORKSPACE_BOX = 'workspace-'
const IDLE: Backup = { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null }
const CHANGED = 'Someone changed this team a moment ago. Try again.'
const ROTATE = 'cloud_rotate'
const ASK_POLL_MS = 2000
let signInError: string | null = null
let checkedAt = 0
let boxes: Promise<unknown> = Promise.resolve()
let asking: { settled: string[]; approved: boolean; error: string | null; timer: NodeJS.Timeout } | undefined
let polling = false
let joinError: string | null = null
const requestedOs = new Map<string, string>()
const invited = new Map<string, string>()
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
    const devices = lists.flatMap((body) => {
      const mine = body?.members.find((member) => member.email === account?.email)
      return body && mine ? mine.devices.filter((key) => key !== mine.kit && key !== accountKey).map((key) => ({ key, here: key === here, addedAt: addedOf(body, key) ? new Date(addedOf(body, key)).toISOString() : null, name: body.names?.[key] ?? null, kind: deviceKind({ runtime: Boolean(body.runtimes?.includes(key)), said: key === here ? { kind: config.installKind, os: deviceOs() } : cloudEvents.beats(body.workspace).get(key) }), joined: joinedOf({ key, accountKey, names: body.names }), os: key === here ? deviceOs() : cloudEvents.beats(body.workspace).get(key)?.os ?? requestedOs.get(key) ?? null, heard: key === here || cloudEvents.beats(body.workspace).has(key), online: key === here || Date.now() - (cloudEvents.beats(body.workspace).get(key)?.at ?? 0) < 3 * BEAT_MS })) : []
    }).filter(({ key }, index, all) => all.findIndex((each) => each.key === key) === index).sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))
    return {
      object: 'cloud', status: locked ? 'locked' : on ? (cloudEvents.ready() ? 'on' : 'offline') : 'off', email: locked?.email ?? (on && account ? account.email : null),
      device: here,
      workspace: on && account && members ? { id: account.workspace.id, version: members.version, members: members.members } : null,
      keyStore: keyStore.kind(), backup: IDLE,
      signInError, devices, needsSignIn: Boolean(locked && !session),
      workspaces: on && account ? roomKeys.rooms().map(({ workspace: { id, key } }) => {
        const body = roomKeys.members(id)
        const invites = (body?.invites ?? []).map((each) => ({ email: each.email, role: each.role, link: roomKeys.link({ ws: id, email: each.email }) ?? null, until: roomKeys.linkUntil({ ws: id, email: each.email }) ?? null }))
        return { id, name: cloudEvents.name(id), website: cloudEvents.site(id), home: id === account.workspace.id, own: roomKeys.isOwn(id), role: roomKeys.roleIn(id) ?? 'member', waiting: !key, members: body?.members ?? [], invites, requests: cloudEvents.requests(id), names: body?.names ?? {} }
      }) : [],
      asking: asked ? { rooms: askRooms.filter((room) => !asked.settled.includes(room.id)).map(({ admins, own }) => ({ admins, own: Boolean(own) })), denied: asked.settled.length === askRooms.length, error: asked.error, name: deviceName() } : null,
      canAsk: Boolean(locked && session),
      rotate: on ? await toRotate() : [],
      gone: await cloudEvents.gone(),
    }
  },

  async ask(): Promise<Cloud> {
    const { email } = mustBeLocked()
    await stopAsking()
    const teams = await teamsOf()
    const own = (await boxesOf()).filter((box) => !teams.includes(box.id))
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
      const asked = await cloud.knock({ team: id }).ask({ name: deviceName(), os: deviceOs(), server: !config.personal }).then(() => ({ status: 200, json: null }), (error: unknown) => error instanceof CloudError ? { status: error.status, json: error.json } : { status: 0, json: null })
      waiting ||= asked.status === 409
      if (asked.status !== 200) refused = z.safeParse(z.object({ error: z.object({ message: z.string() }) }), asked.json).data?.error.message ?? 'OpenHut Cloud couldn’t send your request. Try again.'
      if (asked.status !== 200) continue
      rooms.push({ id, admins: approvers.map((member) => member.email), own: home })
    }
    if (!rooms.length) throw new HttpError(409, refused ?? 'None of your other computers or team admins can let this computer in.', waiting ? { param: 'waiting' } : undefined)
    await keysService.setAsked(rooms)
    resumeAsking()
    return cloudService.status()
  },

  async cancelAsk(): Promise<Cloud> {
    const rooms = keysService.asked()
    await stopAsking()
    for (const { id: workspace } of rooms) await cloud.knock({ team: workspace }).cancel().catch(() => undefined)
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
    if (roomKeys.isOwn(workspace)) await serial(async () => rotate(await keysService.change()))
    else await change({ ws: workspace, rotate: true })
    return cloudService.status()
  },

  async deleteData(): Promise<Cloud> {
    if (keysService.locked() && !keysService.account()) return await deleteLocked()
    const account = keysService.mustBeOn()
    const teams = roomKeys.rooms().map((room) => room.workspace.id).filter((ws) => ws !== account.workspace.id)
    for (const ws of teams) await change({ ws, emails: [account.email] }).catch((err: unknown) => log.warn({ event: 'cloud.leave_failed', error: messageOf(err) }))
    cloudEvents.stop()
    const wiped = await cloud.deleteAccount()
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
    const state = randomBytes(24).toString('base64url')
    const started = await cloud.signIn({ google: { returnTo: `${callbackBase()}/api/cloud/callback`, state } }).catch(fromCloud)
    const url = started.object === 'redirect' ? started.url : ''
    await settings.setSignIns(withSignIn({ pending: settings.signIns(), state, now: Date.now() }))
    if (loginHint) invited.set(state, loginHint.toLowerCase())
    signInError = null
    return { object: 'cloud_authorization', authorizationUrl: hinted({ url, loginHint }) }
  },

  async finish({ state, code, error }: { state?: string; code?: string; error?: string }): Promise<string> {
    const { started, rest } = takeSignIn({ pending: settings.signIns(), state: state ?? '', now: Date.now() })
    const expected = invited.get(state ?? '')
    invited.delete(state ?? '')
    await settings.setSignIns(rest)
    if (!started) return page('This sign-in expired. Go back to OpenHut and try again.')
    if (!code) {
      signInError = error ? 'Sign-in was cancelled.' : 'Google didn’t finish the sign-in. Try again.'
      return page(`${signInError} You can go back to OpenHut.`)
    }
    try {
      const kept = keysService.session()
      const session = await cloud.signIn({ googleCode: code }).catch(fromCloud)
      if (session.object !== 'me') throw new HttpError(502, 'OpenHut Cloud didn’t finish the sign-in. Try again.')
      const back = async () => keysService.setSession(kept)
      if (expected && session.email.toLowerCase() !== expected) {
        await back()
        signInError = `This invite is for ${expected}. You signed in as ${session.email}, so nothing was set up.`
        return page(`This invite is for ${expected}, and you signed in as ${session.email}. Nothing was set up for ${session.email}. Go back to OpenHut and sign in as ${expected}.`, { title: 'Wrong Google account' })
      }
      try {
        keysService.ownedBy(session)
      } catch (err) {
        await back()
        throw err
      }
      const who = { sub: session.sub, email: session.email }
      if (keysService.account()?.sub !== session.sub) {
        if (await accountExists()) {
          log.info({ event: 'cloud.locked', why: 'this account already has a team or a kit' })
          await keysService.setLocked(who)
          return signedIn(session.email)
        }
      }
      const me = session
      if (!me.home) throw new HttpError(502, 'OpenHut Cloud didn’t send your home team. Try again.')
      const home = me.home
      const opened = await serial(async () => openRoom({ account: await keysService.open({ ...who, home, managed: me.managed }) }))
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

  async pasted({ code }: { code: string }): Promise<Cloud> {
    const [state = '', grant = ''] = code.trim().split('.')
    if (!grant || !(state in settings.signIns())) throw new HttpError(400, 'That code expired or isn’t from this sign-in. Sign in again.', { param: 'code' })
    signInError = null
    await cloudService.finish({ state, code: grant })
    if (signInError) throw new HttpError(400, signInError, { param: 'code' })
    return cloudService.status()
  },

  async signOut(): Promise<Cloud> {
    await stopAsking()
    if (keysService.account()?.key && keysService.session()) await leaveHere().catch((err: unknown) => log.warn({ event: 'cloud.leave_failed', error: messageOf(err) }))
    await keysService.setSession(undefined)
    await keysService.setLocked(undefined)
    cloudEvents.stop()
    signInError = null
    return cloudService.status()
  },

  async notMe({ device, lost = false }: { device: string; lost?: boolean }): Promise<Cloud> {
    const account = keysService.mustBeOn()
    const mine = (ws: string) => Boolean(roomKeys.members(ws)?.members.some((member) => member.email === account.email && member.devices.includes(device)))
    const teams = roomKeys.rooms().map((room) => room.workspace.id).filter((ws) => ws !== account.workspace.id && mine(ws))
    if (!mine(account.workspace.id) && !teams.length) throw new HttpError(400, 'Pick one of your other devices to remove.', { param: 'device' })
    await caughtUp({ ws: account.workspace.id, step: async () => { if (mine(account.workspace.id)) await serial(async () => putList({ workspace: account.workspace.id, list: await keysService.dropDevices([device]) })) } })
    for (const ws of teams) await caughtUp({ ws, step: async () => { if (mine(ws)) await change({ ws, devices: [device] }) } })
    await keepToRotate()
    if (lost) return cloudService.changeKeys({ workspace: account.workspace.id })
    return cloudService.status()
  },

  async joinCode(): Promise<JoinCode> {
    keysService.mustBeOn()
    return cloud.joinCode().catch((): never => { throw new HttpError(502, 'OpenHut Cloud couldn’t make a join code. Try again.') })
  },

  async joining(): Promise<Health['join']> {
    if (!config.join) return undefined
    if (keysService.account()) return { state: 'joined', error: null }
    if (joinError) return { state: 'failed', error: joinError }
    const rooms = keysService.asked()
    if (!rooms.length) return { state: 'starting', error: null }
    if (asking && !asking.approved && asking.settled.length >= rooms.length) return { state: 'denied', error: null }
    return { state: 'asking', error: null }
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
  const put = await cloud.team(workspace).publish({ list, letters: letters ?? [], boxes: boxes ?? [] })
  if (put.status !== 200) throw await refusal({ ws: workspace, status: put.status })
  await roomKeys.advance({ lists: [list], ws: workspace })
}

async function change({ ws, emails, devices, rotate = false }: { ws: string; emails?: string[]; devices?: string[]; rotate?: boolean }): Promise<void> {
  const { list, room, letters } = rotate ? await keyring.rotate(ws) : await keyring.remove({ team: ws, emails, devices })
  await putList({ workspace: ws, list, letters })
  if (emails?.includes(keysService.account()?.email ?? '')) return cloudEvents.drop({ ws, why: null })
  if (rotate) await roomKeys.setRoom(room)
}

cloudEvents.onDropped((ws) => serial(() => rotateTeam(ws)).catch((err: unknown) => log.warn({ event: 'cloud.rotate_failed', workspace: ws, error: messageOf(err) })))

async function rotateTeam(ws: string): Promise<void> {
  await caughtUp({
    ws, step: async () => {
      const account = keysService.account()
      if (!account || roomKeys.roleIn(ws) !== 'owner') return
      const { list, room, letters } = await keyring.rotate(ws)
      const boxes = ws === account.workspace.id ? [await keysService.workspaceBox({ account: { ...account, workspace: room.workspace } })] : []
      await putList({ workspace: ws, list, letters, boxes })
      await roomKeys.setRoom(room)
      log.info({ event: 'cloud.rotated', workspace: ws, why: 'a device left' })
    },
  })
}

async function caughtUp({ ws, step }: { ws: string; step: () => Promise<void> }): Promise<void> {
  for (let tries = 1; ; tries++) {
    try {
      return await step()
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 409 || tries === 3) throw err
      await roomKeys.refresh({ ws })
    }
  }
}

async function refusal({ ws, status }: { ws: string; status: number }): Promise<HttpError> {
  if (status === 409) return new HttpError(409, CHANGED)
  if (status !== 403) return new HttpError(502, 'OpenHut Cloud couldn’t save the change. Try again.')
  const newer = await cloud.team(ws).lists({ after: roomKeys.members(ws)?.version ?? 0 }).then((lists) => lists.length > 0, (error: unknown) => error instanceof CloudError && error.status === 403)
  if (newer) return new HttpError(409, CHANGED)
  return new HttpError(403, 'OpenHut Cloud couldn’t save the change. Try again.')
}

async function joinAsServer(code: string): Promise<void> {
  if (keysService.session() && keysService.locked()) return void resumeAsking()
  const me = await cloud.signIn({ joinCode: code }).catch(fromCloud)
  if (me.object !== 'me') throw new HttpError(502, 'OpenHut Cloud didn’t take the join code. Make a new one and try again.')
  const who = { sub: me.sub, email: me.email }
  if (await accountExists()) {
    await keysService.setLocked(who)
    await cloudService.ask()
    return
  }
  if (!me.home) throw new HttpError(502, 'OpenHut Cloud didn’t send your home team. Try again.')
  const home = me.home
  if (!await serial(async () => openRoom({ account: await keysService.open({ ...who, home, managed: me.managed }) }))) throw new HttpError(409, 'Another computer set up this account a moment ago. Run the command again.')
  log.info({ event: 'cloud.first_computer', workspace: home })
  cloudEvents.start()
  if (me.maker) void letInMaker({ workspace: home, device: me.maker }).catch((err: unknown) => log.warn({ event: 'cloud.let_in_failed', error: messageOf(err) }))
}

async function letInMaker({ workspace, device }: { workspace: string; device: string }): Promise<void> {
  for (const end = Date.now() + KNOCK_MS; Date.now() < end; await new Promise((done) => setTimeout(done, ASK_POLL_MS))) {
    await cloudEvents.refreshRequests(workspace)
    const asked = cloudEvents.requests(workspace).find((each) => each.device === device)
    if (!asked) continue
    await serial(async () => {
      const list = await keysService.addDevice({ device, name: asked.name, runtime: false })
      if (list) await putList({ workspace, list })
    })
    log.info({ event: 'cloud.maker_let_in', workspace })
    return
  }
}

function signedIn(email: string): string {
  return page(`Signed in as ${email}. OpenHut has moved on, so you can close this tab.`, { title: 'Done', tab: 'Signed in' })
}

// A server shows as a server: listed as a runtime, or a Linux runtime that says it's a server install (itself, or in its signed beat). Display only, the list is unchanged.
export function deviceKind({ runtime, said }: { runtime: boolean; said?: { kind: string; os?: string } }): 'server' | 'mac' {
  return runtime || (said?.kind === 'server' && said.os === 'Linux') ? 'server' : 'mac'
}

function joinedOf({ key, accountKey, names }: { key: string; accountKey: string | null | undefined; names: Record<string, string> | undefined }): Cloud['devices'][number]['joined'] {
  const by = roomKeys.joinedBy(key)
  if (!by) return null
  if (by === accountKey) return { how: 'recovery' }
  return { how: 'approved', by: names?.[by] ?? null }
}

async function accountExists(): Promise<boolean> {
  const me = await cloud.me()
  if (!me) throw new HttpError(502, 'OpenHut Cloud couldn’t check your account. Try again.')
  return me.workspaces.length > 0
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
  const workspaces = account && await cloud.keyBoxes.list()
  if (account && workspaces && !workspaces.some((each) => each.id === `${WORKSPACE_BOX}${account.workspace.id}`)) await lockOut(account)
}

async function lockOut({ sub, email }: Account): Promise<void> {
  cloudEvents.stop()
  await keysService.relock({ sub, email })
}

async function boxesOf(): Promise<{ id: string; key: string; chain: MemberList[] }[]> {
  const listed = await cloud.keyBoxes.list() ?? []
  const boxes = listed.filter((box) => box.id.startsWith(WORKSPACE_BOX)).map((box) => ({ id: box.id.slice(WORKSPACE_BOX.length), key: box.body }))
  return Promise.all(boxes.map(async (box) => ({ ...box, chain: await chainOf(box.id) })))
}

async function chainOf(workspace: string): Promise<MemberList[]> {
  return cloud.team(workspace).lists().catch(() => [])
}

async function joinWith(restored: Account): Promise<Cloud> {
  const signedHere = await keyring.signedHere(restored)
  const joined = signedHere ? await cloud.team(restored.workspace.id).publish({ list: restored.list, letters: [], boxes: [] }) : { status: 200 }
  if (joined.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t add this computer. Try again.')
  const teams = []
  for (const team of restored.teams ?? []) if ((await cloud.team(team.workspace.id).publish({ list: team.list, letters: [], boxes: [] })).status === 200) teams.push(team)
  const account = { ...restored, teams }
  await keysService.adopt({ account })
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
  for (const room of roomKeys.rooms()) {
    if (!bodyOf(room.list)?.members.some((member) => member.devices.includes(me))) continue
    const { list } = await keyring.remove({ team: room.workspace.id, devices: [me] })
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
  const wiped = await cloud.deleteAccount()
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
  for (const { id: workspace, own } of keysService.asked().filter((each) => !now.settled.includes(each.id))) {
    const got = await cloud.team(workspace).letters().then((found) => ({ status: 200, found }), (error: unknown) => ({ status: error instanceof CloudError ? error.status : 0, found: [] as Letter[] }))
    if (got.status === 403 && own) return removed()
    const { found } = got
    if (own && await unlockedBy({ workspace, found })) return
    const chain = (!own || !config.personal) && found.length ? await chainOf(workspace) : []
    if (chain.length && await roomKeys.joinApproved({ ws: workspace, chain, found })) {
      for (const each of found) await cloud.team(workspace).take(each.id)
      now.settled.push(workspace)
      now.approved = true
      cloudService.connect()
      continue
    }
    const mine = await cloud.knock({ team: workspace }).mine()
    if (!mine?.asked) now.settled.push(workspace)
  }
  if (now.settled.length < keysService.asked().length) return
  if (now.approved) return stopAsking()
  clearInterval(now.timer)
}

async function unlockedBy({ workspace, found }: { workspace: string; found: Letter[] }): Promise<boolean> {
  for (const each of found.filter((one) => one.purpose === 'account-key')) {
    const account = await keyring.restore({ from: { letter: each, workspace }, workspaces: async () => {
      const boxes = await boxesOf()
      return [...boxes.filter((box) => box.id === workspace), ...boxes.filter((box) => box.id !== workspace)]
    } })
    if (!account || !listedUnder({ account, device: each.from })) continue
    await joinWith(account)
    await cloud.team(workspace).take(each.id).catch(() => undefined)
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

async function rotate({ list, next, letters }: Awaited<ReturnType<typeof keysService.change>>): Promise<void> {
  const boxes: Box[] = await Promise.all([next, ...(next.teams ?? []).filter((each) => each.workspace.key)].map((room) => keysService.workspaceBox({ account: next, room })))
  const put = await cloud.team(next.workspace.id).publish({ list, letters, boxes })
  if (put.status === 409) throw new HttpError(409, 'Your devices changed on another computer just now. Try again.')
  if (put.status !== 200) throw new HttpError(put.status === 403 ? 403 : 502, 'OpenHut Cloud couldn’t save the change. Try again.')
  await keysService.adopt({ account: next })
  for (const team of next.teams ?? []) await cloudEvents.refreshKeys(team.workspace.id)
}

async function openRoom({ account }: { account: Account }): Promise<boolean> {
  const managed = bodyOf(account.list)?.managed
  const boxes = [await keysService.workspaceBox({ account }), ...managed ? [await keysService.escrowBox({ account, to: managed })] : []]
  const made = await cloud.team(account.workspace.id).publish({ list: account.list, letters: [], boxes })
  if (made.status === 403) {
    log.warn({ event: 'cloud.room_refused', workspace: account.workspace.id, reply: JSON.stringify(made.json).slice(0, 300) })
    return false
  }
  if (made.status !== 200 && made.status !== 409) throw new HttpError(502, 'OpenHut Cloud couldn’t open this team. Try again.')
  return true
}

async function teamsOf(): Promise<string[]> {
  const me = await cloud.me()
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
