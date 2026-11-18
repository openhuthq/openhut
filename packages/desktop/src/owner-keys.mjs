import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function ownerKeys({ dir, safeStorage, name }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const owner = await keyIn({ file: join(dir, 'owner.key'), type: 'ed25519', safeStorage })
  const device = await keyIn({ file: join(dir, 'device.key'), type: 'x25519', safeStorage })
  return {
    key: raw(owner),
    sign: async (text) => sign(null, Buffer.from(text), owner).toString('hex'),
    self: { key: raw(device), name },
    device: { publicKey: Buffer.from(raw(device), 'hex'), secretKey: Buffer.from(device.export({ format: 'jwk' }).d, 'base64url') },
  }
}

export function deviceName(hostname) {
  return hostname.replace(/\.local$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 100) || 'Mac'
}

async function keyIn({ file, type, safeStorage }) {
  if (!existsSync(file)) {
    const pem = generateKeyPairSync(type).privateKey.export({ format: 'pem', type: 'pkcs8' })
    writeFileSync(file, await safeStorage.encryptStringAsync(pem), { mode: 0o600 })
  }
  return createPrivateKey((await safeStorage.decryptStringAsync(readFileSync(file))).result)
}

function raw(privateKey) {
  return Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url').toString('hex')
}
