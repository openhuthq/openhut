declare module 'sodium-javascript' {
  const sodium: { crypto_sign_verify_detached: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean }
  export default sodium
}
