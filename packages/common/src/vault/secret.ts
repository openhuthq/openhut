import { HEADER, KEY, LETTER_PURPOSES, NEWEST, SIGNATURE, check, concat, deviceKem, equal, field, fromBase64, header, newKey, readHeader, sign, subtle, suites, text, toBase64, type Bytes, type Identity, type LetterPurpose, type Suite } from './public.ts'

export async function lock({ key, version, bind, plain }: { key: Bytes; version: number; bind: string; plain: Bytes }): Promise<Bytes | null> {
  const head = header({ version })
  if (!head || key.length !== KEY) return null
  const suite = suites[NEWEST]
  const nonce = newKey(suite.nonce)
  const aes = await recordKey({ suite, key, nonce, bind })
  const sealed = await subtle.encrypt({ name: suite.aead, iv: nonce, additionalData: concat([head, text.encode(bind)]) }, aes, plain)
  return concat([head, nonce, new Uint8Array(sealed)])
}

export async function unlock({ keys, bind, locked }: { keys: Record<number, Bytes>; bind: string; locked: Bytes }): Promise<Bytes | null> {
  const head = readHeader(locked)
  if (!head) return null
  const key = keys[head.version]
  if (!key) return null
  const suite = suites[head.suite]
  const nonce = locked.slice(HEADER, HEADER + suite.nonce)
  const aes = await recordKey({ suite, key, nonce, bind }).catch(() => null)
  const additionalData = concat([locked.slice(0, HEADER), text.encode(bind)])
  const plain = aes && (await subtle.decrypt({ name: suite.aead, iv: nonce, additionalData }, aes, locked.slice(HEADER + suite.nonce)).catch(() => null))
  return plain ? new Uint8Array(plain) : null
}

export async function letter({ sender, to, workspace, purpose, version, plain }: { sender: Identity; to: Bytes; workspace: string; purpose: LetterPurpose; version: number; plain: Bytes }): Promise<Bytes | null> {
  const head = header({ version })
  if (!head) return null
  const context = letterContext({ head, from: sender.publicKey, to, purpose, workspace })
  const signature = await sign({ secret: sender.secret, bytes: concat([context, plain]) })
  const senderKey = await deviceKem.deriveKeyPair(sender.secret)
  const recipientPublicKey = await deviceKem.deserializePublicKey(to.slice(32))
  const { ct, enc } = await suites[NEWEST].hpke.seal({ recipientPublicKey, senderKey, info: context }, concat([signature, plain]), context)
  return concat([head, new Uint8Array(enc), new Uint8Array(ct)])
}

export async function read({ recipient, from, workspace, purpose, body, allowed }: { recipient: Identity; from: Bytes; workspace: string; purpose: LetterPurpose; body: Bytes; allowed: Bytes[] }): Promise<Bytes | null> {
  const head = readHeader(body)
  if (!head || !LETTER_PURPOSES.includes(purpose) || from.length !== 64) return null
  const { hpke, enc, tag } = suites[head.suite]
  if (body.length < HEADER + enc + SIGNATURE + tag || !allowed.some((key) => equal({ a: key, b: from }))) return null
  const context = letterContext({ head: body.slice(0, HEADER), from, to: recipient.publicKey, purpose, workspace })
  const recipientKey = await deviceKem.deriveKeyPair(recipient.secret)
  const senderPublicKey = await deviceKem.deserializePublicKey(from.slice(32)).catch(() => null)
  if (!senderPublicKey) return null
  const opened = await hpke.open({ recipientKey, senderPublicKey, enc: body.slice(HEADER, HEADER + enc), info: context }, body.slice(HEADER + enc), context).catch(() => null)
  if (!opened) return null
  const signature = new Uint8Array(opened.slice(0, SIGNATURE))
  const plain = new Uint8Array(opened.slice(SIGNATURE))
  return (await check({ publicKey: from, bytes: concat([context, plain]), signature })) ? plain : null
}

function letterContext({ head, from, to, purpose, workspace }: { head: Bytes; from: Bytes; to: Bytes; purpose: LetterPurpose; workspace: string }): Bytes {
  return concat([text.encode('openhut/letter\0'), head, from, to, field(purpose), field(workspace)])
}

export async function slot({ key, path }: { key: Bytes; path: string }): Promise<string> {
  const hmac = await subtle.importKey('raw', await derive({ key, info: 'openhut/slot' }), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toBase64(new Uint8Array(await subtle.sign('HMAC', hmac, text.encode(path))))
}

export async function lockInvite({ secret, workspace, plain }: { secret: Bytes; workspace: string; plain: Bytes }): Promise<Bytes | null> {
  return lock({ key: await inviteKey(secret), version: 1, bind: `invite/${workspace}`, plain })
}

export async function openInvite({ secret, workspace, locked }: { secret: Bytes; workspace: string; locked: Bytes }): Promise<Bytes | null> {
  return unlock({ keys: { 1: await inviteKey(secret) }, bind: `invite/${workspace}`, locked })
}

async function inviteKey(secret: Bytes): Promise<Bytes> {
  return fromBase64(await slot({ key: secret, path: 'invite' }))
}

async function recordKey({ suite, key, nonce, bind }: { suite: Suite; key: Bytes; nonce: Bytes; bind: string }): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', key, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: suite.hash, salt: nonce, info: text.encode(`openhut/lock\0${bind}`) }, base, { name: suite.aead, length: 256 }, false, ['encrypt', 'decrypt'])
}

async function derive({ key, info }: { key: Bytes; info: string }): Promise<Bytes> {
  const base = await subtle.importKey('raw', key, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: text.encode(info) }, base, 256))
}
