import * as z from 'zod/mini'

export const BundleManifest = z.object({
  bundleId: z.string().check(z.regex(/^[0-9A-Za-z_-]{1,100}$/)),
  sequence: z.number().check(z.int(), z.minimum(0)),
  appVersion: z.string().check(z.minLength(1), z.maxLength(50)),
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  url: z.string().check(z.regex(/^https?:\/\//)),
  bundleSignature: z.string().check(z.minLength(1)),
  signature: z.string().check(z.minLength(1)),
})
export type BundleManifest = z.infer<typeof BundleManifest>

type Verdict = { manifest: BundleManifest } | { refused: string }

export async function latestBundle({ updatesUrl, key, appVersion, highest }: { updatesUrl: string; key: string; appVersion: string; highest: number }): Promise<Verdict> {
  const response = await fetch(`${updatesUrl}/${encodeURIComponent(appVersion)}/latest`, { cache: 'no-store' })
  if (!response.ok) return { refused: `the update host answered ${response.status}` }
  return accepted({ body: await response.json(), key, appVersion, highest })
}

export async function accepted({ body, key, appVersion, highest }: { body: unknown; key: string; appVersion: string; highest: number }): Promise<Verdict> {
  const parsed = BundleManifest.safeParse(body)
  if (!parsed.success) return { refused: 'the manifest is malformed' }
  const manifest = parsed.data
  if (!(await signed({ manifest, key }))) return { refused: `the signature of ${manifest.bundleId} doesn't verify` }
  if (manifest.appVersion !== appVersion) return { refused: `${manifest.bundleId} is for app ${manifest.appVersion}, not ${appVersion}` }
  if (manifest.sequence <= highest) return { refused: `${manifest.bundleId} has sequence ${manifest.sequence}, and ${highest} is already applied` }
  return { manifest }
}

function canonicalManifest(manifest: Omit<BundleManifest, 'signature'> & { signature?: string }): string {
  const { signature: _signature, ...rest } = manifest
  return JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1))))
}

async function signed({ manifest, key }: { manifest: BundleManifest; key: string }): Promise<boolean> {
  try {
    const spki = base64(key.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, ''))
    const publicKey = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64(manifest.signature), new TextEncoder().encode(canonicalManifest(manifest)))
  } catch {
    return false
  }
}

function base64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}
