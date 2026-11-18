declare module 'noise-handshake' {
  export type KeyPair = { publicKey: Uint8Array; secretKey?: Uint8Array }
  export type Curve = {
    DHLEN: number
    PKLEN: number
    SKLEN: number
    ALG: string
    generateKeyPair: (secretKey?: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array }
    dh: (publicKey: Uint8Array, keyPair: KeyPair) => Uint8Array
  }
  export default class NoiseState {
    constructor(pattern: string, initiator: boolean, staticKeypair?: KeyPair | null, opts?: { curve?: Curve })
    e: KeyPair | null
    rs: Uint8Array | null
    hash: Uint8Array | null
    tx: Uint8Array | null
    rx: Uint8Array | null
    complete: boolean
    initialise(prologue: Uint8Array, remoteStatic?: Uint8Array): void
    send(payload?: Uint8Array): Uint8Array
    recv(message: Uint8Array): Uint8Array
  }
}

declare module 'noise-handshake/dh.js' {
  const curve: import('noise-handshake').Curve
  export default curve
}

declare module 'noise-handshake/cipher.js' {
  export default class Cipher {
    constructor(key: Uint8Array)
    encrypt(plaintext: Uint8Array): Uint8Array
    decrypt(ciphertext: Uint8Array): Uint8Array
  }
}
