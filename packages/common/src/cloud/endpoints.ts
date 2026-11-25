import * as z from 'zod/mini'
import { AskAdmin, DeviceKey } from './cloud.ts'
import { CreateJoinRequest } from './v1/trust.ts'

export type Auth = 'none' | 'device' | 'token' | 'signed' | 'computer'
export type Endpoint = { call: 'signIn' | 'records' | 'tunnel' | 'connections' | 'ops'; method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'WSS'; path: string; auth: Auth; does: string }

export const ENDPOINTS = {
  startSignIn: { call: 'signIn', method: 'POST', path: '/v1/sign-ins', auth: 'none', does: 'Start Google sign-in for a device key. Returns the Google URL. The return address must be app.openhut.dev or a loopback address.' },
  signInCallback: { call: 'signIn', method: 'GET', path: '/v1/sign-ins/callback', auth: 'none', does: 'Google comes back here. Redirects to the return address with a one-use code.' },
  createSession: { call: 'signIn', method: 'POST', path: '/v1/sessions', auth: 'device', does: 'Trade a grant for a token: google (the code, signed by the device), join_code (signed by the device), or refresh.' },
  getCredits: { call: 'signIn', method: 'GET', path: '/v1/credits', auth: 'token', does: 'The credit balance and the OpenHut models. The OpenRouter key only to the account’s Cloud computer, while the balance is above $0.' },
  me: { call: 'signIn', method: 'GET', path: '/v1/me', auth: 'token', does: 'The account, and each team with this device’s access (listed, waiting).' },
  deleteMe: { call: 'signIn', method: 'DELETE', path: '/v1/me', auth: 'computer', does: 'Delete the account. Signed, and allowed from a computer only.' },
  createJoinCode: { call: 'signIn', method: 'POST', path: '/v1/join-codes', auth: 'signed', does: 'A one-use, 10-minute code for a team. Only the hash is stored. A computer makes one any time; any signed-in device makes one only while the account has no computer (device.firstComputerCode, the web first run). With { web: true } it lasts 60 seconds, for Continue in web: the maker then reads which device used it.' },
  startCloudComputer: { call: 'signIn', method: 'POST', path: '/v1/cloud-computer', auth: 'signed', does: 'Start the person\u2019s Cloud computer (one Boat VM), or adopt the one starting. 409 when this server has no Boat key, 402 at $0. It joins with a server code and lets in the device that asked.' },
  getJoinCode: { call: 'signIn', method: 'GET', path: '/v1/join-codes/:code', auth: 'token', does: 'Which device used a Continue in web code (null until one did). Only the device that made the code may ask.' },
  listRecords: { call: 'records', method: 'GET', path: '/v1/teams/:team/:kind', auth: 'token', does: 'List one kind, ordered, paged with ?after=.' },
  getRecord: { call: 'records', method: 'GET', path: '/v1/teams/:team/:kind/:id', auth: 'token', does: 'Read one record (sealed).' },
  putRecord: { call: 'records', method: 'PUT', path: '/v1/teams/:team/:kind/:id', auth: 'signed', does: 'Write one record. If-Match: <version>; a conflict returns 409 with the newer copy. Blobs stream through the same path as kind blob.' },
  deleteRecord: { call: 'records', method: 'DELETE', path: '/v1/teams/:team/:kind/:id', auth: 'signed', does: 'Delete one record.' },
  watch: { call: 'records', method: 'WSS', path: '/v1/watch', auth: 'token', does: 'One socket per device for all its teams: record changes, plus presence (relayed, never stored, 8 KiB cap).' },
  tunnel: { call: 'tunnel', method: 'WSS', path: '/v1/tunnels/:computer', auth: 'token', does: 'Join a tunnel with ?role=computer|device. The token goes in as a WebSocket subprotocol. A computer may only open its own id. Noise end to end.' },
  createOAuthAuthorization: { call: 'connections', method: 'POST', path: '/v1/oauth-authorizations', auth: 'token', does: 'Start an OAuth connection for a computer.' },
  oauthCallback: { call: 'connections', method: 'GET', path: '/v1/oauth-authorizations/callback', auth: 'none', does: 'The provider comes back here.' },
  createOAuthToken: { call: 'connections', method: 'POST', path: '/v1/oauth-tokens', auth: 'token', does: 'Exchange or refresh a connection’s token.' },
  createChannel: { call: 'connections', method: 'POST', path: '/v1/channels', auth: 'signed', does: 'A Cloud computer hands a channel (agent, kind, token) to the Cloud, which becomes its webhook and holds its events.' },
  listChannels: { call: 'connections', method: 'GET', path: '/v1/channels', auth: 'token', does: 'This computer’s channels on the Cloud.' },
  deleteChannel: { call: 'connections', method: 'DELETE', path: '/v1/channels/:id', auth: 'signed', does: 'Remove the webhook and the pending events (the agent left or the channel was turned off).' },
  listChannelEvents: { call: 'connections', method: 'GET', path: '/v1/channels/:id/events', auth: 'token', does: 'Events held for this computer, in order; ?after acknowledges every event up to it.' },
  putRoutine: { call: 'connections', method: 'PUT', path: '/v1/routines/:id', auth: 'signed', does: 'A routine’s next run (never its prompt), so the Cloud wakes the computer for it.' },
  health: { call: 'ops', method: 'GET', path: '/health', auth: 'none', does: 'Ready once migrations ran and the database answers.' },
} as const satisfies Record<string, Endpoint>

export type EndpointName = keyof typeof ENDPOINTS

export function pathOf({ name, params = {} }: { name: EndpointName; params?: Record<string, string> }): string {
  return ENDPOINTS[name].path.replace(/:(\w+)/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) throw new Error(`Give ${key} for ${name}.`)
    return encodeURIComponent(value)
  })
}

export const CreateSignIn = z.object({ device: DeviceKey, returnTo: z.string().check(z.maxLength(500)), state: z.string().check(z.minLength(8), z.maxLength(200)) })
export type CreateSignIn = z.infer<typeof CreateSignIn>
export const SignInStarted = z.object({ object: z.literal('sign_in'), url: z.string() })
export type SignInStarted = z.infer<typeof SignInStarted>

export const PutJoinRequest = z.union([
  z.object({ ...AskAdmin.shape, server: CreateJoinRequest.shape.server, commit: CreateJoinRequest.shape.commit, passkey: CreateJoinRequest.shape.passkey }),
  z.object({ nonce: CreateJoinRequest.shape.commit.def.innerType }),
  z.object({ reviewed: z.literal(true) }),
])
export type PutJoinRequest = z.infer<typeof PutJoinRequest>
