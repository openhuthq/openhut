import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8099)
const dir = process.argv[3] ?? 'dist'

createServer(async (req, res) => {
  const name = req.url === '/' ? 'install.sh' : (req.url ?? '').replace(/^\/+/, '')
  if (!/^[\w.-]+$/.test(name)) return res.writeHead(404).end()
  const body = await readFile(`${dir}/${name}`).catch(() => null)
  if (!body) return res.writeHead(404).end()
  res.writeHead(200).end(body)
}).listen(port, '127.0.0.1', () => console.log(`serving ${dir}/ on :${port}`))
