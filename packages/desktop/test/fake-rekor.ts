import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'

const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest()

// A stand-in for rekor.sigstore.dev: stores a rekord as Rekor does (the data's hash, not the data) in a one-leaf tree, signs the SET and checkpoint.
export function fakeRekor(time: () => number) {
  const log = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const rekorKey = log.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const { apiVersion, kind, spec } = JSON.parse(raw)
      const data = Buffer.from(spec.data.content, 'base64')
      const body = Buffer.from(JSON.stringify({ apiVersion, kind, spec: { data: { hash: { algorithm: 'sha256', value: sha256(data).toString('hex') } }, signature: spec.signature } })).toString('base64')
      const entry: any = { body, integratedTime: time(), logID: sha256(Buffer.from(rekorKey, 'base64')).toString('hex'), logIndex: 0 }
      const leaf = sha256(Buffer.from([0]), Buffer.from(body, 'base64'))
      const note = `fake - 1\n1\n${leaf.toString('base64')}\n`
      const checkpoint = `${note}\n— fake ${Buffer.concat([Buffer.alloc(4), sign('sha256', Buffer.from(note), log.privateKey)]).toString('base64')}\n`
      entry.verification = {
        signedEntryTimestamp: sign('sha256', Buffer.from(JSON.stringify(entry)), log.privateKey).toString('base64'),
        inclusionProof: { checkpoint, hashes: [], logIndex: 0, rootHash: leaf.toString('hex'), treeSize: 1 },
      }
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ [sha256(Buffer.from(body, 'base64')).toString('hex')]: entry }))
    })
  })
  return { rekorKey, server }
}
