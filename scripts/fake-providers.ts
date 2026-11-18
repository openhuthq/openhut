import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.FAKE_PROVIDERS_PORT ?? 18650)
const SIGN_IN_MS = Number(process.env.FAKE_CODEX_SIGN_IN_MS ?? 4000)
const USER_CODE = 'WDJB-MJHT'
const NOW = 1_763_000_000
const OPENROUTER = [
  ['anthropic/claude-opus-5.5', 'Claude Opus 5.5', 500000, 15, 75], ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', 500000, 3, 15], ['anthropic/claude-haiku-5.5', 'Claude Haiku 5.5', 200000, 0.8, 4],
  ['openai/gpt-5.5', 'GPT-5.5', 400000, 2.5, 15], ['openai/gpt-5.5-mini', 'GPT-5.5 mini', 400000, 0.3, 1.2], ['google/gemini-3.5-pro', 'Gemini 3.5 Pro', 1000000, 2, 12],
  ['google/gemini-3.5-flash', 'Gemini 3.5 Flash', 1000000, 0.2, 0.8], ['x-ai/grok-5', 'Grok 5', 256000, 3, 15], ['x-ai/grok-5-mini', 'Grok 5 mini', 256000, 0.3, 0.5],
  ['deepseek/deepseek-v4', 'DeepSeek V4', 128000, 0.3, 1.1], ['deepseek/deepseek-r2', 'DeepSeek R2', 128000, 0.5, 2.2], ['meta-llama/llama-5-405b', 'Llama 5 405B', 128000, 1.8, 1.8],
  ['meta-llama/llama-5-70b', 'Llama 5 70B', 128000, 0.4, 0.4], ['mistralai/mistral-large-3', 'Mistral Large 3', 128000, 2, 6], ['mistralai/codestral-3', 'Codestral 3', 256000, 0.3, 0.9],
  ['qwen/qwen-3.5-max', 'Qwen 3.5 Max', 256000, 1.2, 4], ['qwen/qwen-3.5-coder', 'Qwen 3.5 Coder', 256000, 0.3, 1], ['moonshotai/kimi-k3', 'Kimi K3', 256000, 0.6, 2.5],
  ['z-ai/glm-5', 'GLM 5', 200000, 0.6, 2.2], ['cohere/command-a-2', 'Command A 2', 256000, 2.5, 10], ['perplexity/sonar-pro-2', 'Sonar Pro 2', 200000, 3, 15],
  ['nvidia/nemotron-5-ultra', 'Nemotron 5 Ultra', 128000, 1, 3], ['amazon/nova-3-pro', 'Nova 3 Pro', 300000, 0.8, 3.2], ['microsoft/phi-5', 'Phi 5', 128000, 0.1, 0.3],
].map(([id, name, context, input, output], index) => ({
  id, name, created: NOW + index, context_length: context, pricing: { prompt: String(Number(input) / 1e6), completion: String(Number(output) / 1e6) }, architecture: { output_modalities: ['text'] },
}))
const EXTRA = Math.max(0, Number(process.env.FAKE_OPENROUTER_COUNT ?? 0) - OPENROUTER.length)
OPENROUTER.push(...Array.from({ length: EXTRA }, (_, index) => ({ id: `fake/model-${index}`, name: `Fake model ${index}`, created: NOW - index, context_length: 128000, pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { output_modalities: ['text'] } })))
const OPENAI = ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-nano', 'o5', 'o5-mini', 'gpt-4.1', 'dall-e-3', 'text-embedding-3-large', 'whisper-1', 'gpt-5.5-realtime-preview'].map((id, index) => ({ id, object: 'model', created: NOW + index, owned_by: 'fake' }))
const XAI = ['grok-5', 'grok-5-mini', 'grok-code-fast-2', 'grok-imagine-image'].map((id, index) => ({ id, object: 'model', created: NOW + index, owned_by: 'fake' }))
const CODEX = [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', context_window: 272000, visibility: 'list' }, { slug: 'gpt-5.5-mini', display_name: 'GPT-5.5 mini', context_window: 272000, visibility: 'list' }, { slug: 'gpt-5.5-internal', display_name: 'Internal', visibility: 'hide' }]
const signIns = new Map<string, number>()

export function fakeProviders({ port = PORT }: { port?: number } = {}): Server {
  const server = createServer((req, res) => void answer(req, res, port).catch(() => res.writeHead(500).end()))
  server.listen(port, '127.0.0.1')
  return server
}

export const fakeProviderEnv = (port = PORT) => ({
  OPENHUT_OPENROUTER_API: `http://127.0.0.1:${port}/openrouter/api`,
  OPENHUT_OPENAI_API: `http://127.0.0.1:${port}/openai`,
  OPENHUT_XAI_API: `http://127.0.0.1:${port}/xai`,
  OPENHUT_CODEX_API: `http://127.0.0.1:${port}/codex`,
  OPENHUT_CODEX_AUTH_API: `http://127.0.0.1:${port}/codex-auth`,
})

async function answer(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  const body = await read(req)
  const route = `${req.method} ${url.pathname}`
  const [, vendor = ''] = url.pathname.split('/')
  const key = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
  console.log(`fake-providers: ${route}${key ? ` (key ${key.slice(0, 6)}…)` : ''}`)
  if (route === 'POST /codex-auth/api/accounts/deviceauth/usercode') {
    signIns.set('device-1', Date.now() + SIGN_IN_MS)
    return json(res, 200, { device_auth_id: 'device-1', user_code: USER_CODE, interval: 2 })
  }
  if (route === 'POST /codex-auth/api/accounts/deviceauth/token') {
    return (signIns.get('device-1') ?? Infinity) <= Date.now() ? json(res, 200, { authorization_code: 'fake-code', code_verifier: 'fake-verifier' }) : json(res, 403, { error: 'authorization_pending' })
  }
  if (route === 'POST /codex-auth/oauth/token') return json(res, 200, { access_token: codexToken(), refresh_token: `fake-refresh-${Date.now()}` })
  if (route === 'GET /codex-auth/codex/device') return html(res, `<h1>Fake ChatGPT sign-in</h1><p>Enter ${USER_CODE}. This page is the fake provider: the sign-in completes by itself a few seconds after the app asked for the code.</p>`)
  if (vendor === 'codex') return codex({ res, route, url, body })
  if (vendor === 'openrouter' || vendor === 'openai' || vendor === 'xai') return keyed({ res, vendor, route: route.replace(`/${vendor}`, '').replace('/api', ''), key, body })
  json(res, 404, { error: { message: `fake-providers has no ${route}` } })
}

function codex({ res, route, url, body }: { res: ServerResponse; route: string; url: URL; body: string }): void {
  if (route === 'GET /codex/models') return json(res, 200, { models: CODEX })
  if (route === 'POST /codex/responses' || route === 'POST /codex/responses/compact') return responses({ res, vendor: 'Codex', body })
  json(res, 404, { error: { message: `fake Codex has no ${route}${url.search}` } })
}

function keyed({ res, vendor, route, key, body }: { res: ServerResponse; vendor: string; route: string; key: string; body: string }): void {
  const refused = !key || /bad/i.test(key)
  const name = { openrouter: 'OpenRouter', openai: 'OpenAI', xai: 'xAI' }[vendor] ?? vendor
  if (route === 'GET /v1/models' && vendor === 'openrouter') return json(res, 200, { data: OPENROUTER })
  if (route === 'GET /v1/key' && vendor === 'openrouter') return refused ? json(res, 401, { error: { message: 'No auth credentials found' } }) : json(res, 200, { data: { label: 'fake' } })
  if (refused) return json(res, 401, { error: { message: 'Incorrect API key provided.' } })
  if (route === 'GET /v1/models') return json(res, 200, { object: 'list', data: vendor === 'openai' ? OPENAI : XAI })
  if (route === 'POST /v1/chat/completions') return chat({ res, vendor: name, body })
  if (route === 'POST /v1/responses') return responses({ res, vendor: name, body })
  json(res, 404, { error: { message: `fake ${name} has no ${route}` } })
}

function chat({ res, vendor, body }: { res: ServerResponse; vendor: string; body: string }): void {
  const request = parsed(body)
  const text = replyOf({ vendor, request })
  const base = { id: 'chatcmpl-fake', created: NOW, model: request.model ?? 'fake' }
  if (!request.stream) return json(res, 200, { ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  res.end('data: [DONE]\n\n')
}

function responses({ res, vendor, body }: { res: ServerResponse; vendor: string; body: string }): void {
  const request = parsed(body)
  const text = replyOf({ vendor, request })
  const done = { id: 'resp_fake', object: 'response', status: 'completed', model: request.model ?? 'fake', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }
  if (!request.stream) return json(res, 200, done)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`)
  res.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: done })}\n\n`)
}

function replyOf({ vendor, request }: { vendor: string; request: Request }): string {
  const last = [...(request.messages ?? [])].reverse().find((message) => message.role === 'user')?.content ?? request.input ?? ''
  return `Fake ${vendor} reply (${request.model ?? 'no model'}): ${typeof last === 'string' ? last.slice(0, 200) : 'ok'}`
}

function codexToken(): string {
  const claims = { exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-fake' } }
  return `fake.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
}

type Request = { model?: string; stream?: boolean; messages?: { role?: string; content?: unknown }[]; input?: unknown }

function parsed(body: string): Request {
  try { return JSON.parse(body || '{}') } catch { return {} }
}

async function read(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>Fake sign-in</title>${body}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fakeProviders()
  console.log(`fake model providers on 127.0.0.1:${PORT}. Start the app against them with:\n${Object.entries(fakeProviderEnv()).map(([name, value]) => `export ${name}=${value}`).join('\n')}\nnpm run dev`)
}
