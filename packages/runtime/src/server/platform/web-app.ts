import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.ts'
import { errorBody } from './http-error.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
}

export function webApp(req: FastifyRequest, reply: FastifyReply): FastifyReply {
  const path = decoded(req.url.split('?')[0] ?? '/')
  if ((req.method !== 'GET' && req.method !== 'HEAD') || path.startsWith('/api/') || !existsSync(join(config.appDir, 'index.html'))) {
    return reply.status(404).send(errorBody({ status: 404, message: `There's no ${req.method} ${path}.` }))
  }
  const asked = join(config.appDir, normalize(path))
  const file = asked.startsWith(config.appDir) && existsSync(asked) && statSync(asked).isFile() ? asked : join(config.appDir, 'index.html')
  const immutable = file.startsWith(join(config.appDir, 'assets'))
  return reply.type(TYPES[extname(file)] ?? 'application/octet-stream')
    .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    .send(createReadStream(file))
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return '/'
  }
}
