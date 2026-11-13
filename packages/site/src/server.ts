import { readFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { SITE } from './site.ts'

export function siteServer(release: string) {
  return createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    const page = SITE.get(path)
    res.setHeader('vary', 'Accept')
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(404).end()
    if (path === '/' && !req.headers.accept?.includes('text/html')) return sendFile(res, join(release, 'install.sh'), 'text/plain; charset=utf-8')
    if (path === '/jakebox.tgz') return sendFile(res, join(release, 'jakebox.tgz'), 'application/gzip')
    if (page === undefined) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  })
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '8099' }, release: { type: 'string', default: 'dist' } } })
  siteServer(values.release).listen(Number(values.port), '127.0.0.1', () => console.log(`serving ${values.release}/ on :${values.port}`))
}

async function sendFile(res: ServerResponse, file: string, type: string) {
  const body = await readFile(file).catch(() => null)
  if (body === null) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': type }).end(body)
}
