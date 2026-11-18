import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.FAKE_PROVIDERS_PORT ?? 18650)
const SIGN_IN_MS = Number(process.env.FAKE_CODEX_SIGN_IN_MS ?? 4000)
const USER_CODE = 'WDJB-MJHT'
const NOW = 1_763_000_000
const OPENROUTER = [
  ['anthropic/claude-opus-5.5', 'Anthropic: Claude Opus 5.5', 1000000, 4, 20], ['anthropic/claude-sonnet-5.5', 'Anthropic: Claude Sonnet 5.5', 1000000, 2, 10],
  ['openai/gpt-6.2-sol', 'OpenAI: GPT-6.2 Sol', 1050000, 2, 10], ['openai/gpt-6.1-terra', 'OpenAI: GPT-6.1 Terra', 1050000, 1, 5],
  ['google/gemini-4-argon', 'Google: Gemini 4 Argon', 1048576, 2, 10], ['google/gemini-3.8-flash', 'Google: Gemini 3.8 Flash', 1048576, 0.825, 4.125],
  ['x-ai/grok-4.7', 'SpaceXAI: Grok 4.7', 500000, 2, 6], ['deepseek/deepseek-v4-pro-0813', 'DeepSeek: DeepSeek V4 Pro 0813', 1048576, 0.111, 4.44],
  ['deepseek/deepseek-v4.1-flash', 'DeepSeek: DeepSeek V4.1 Flash', 1048576, 0.051, 0.567], ['qwen/qwen4-max', 'Qwen: Qwen4 Max', 1000000, 1.425, 4.275],
  ['qwen/qwen3.8-flash', 'Qwen: Qwen3.8 Flash', 1000000, 0.15, 0.47], ['moonshotai/kimi-k3.1-pro', 'MoonshotAI: Kimi K3.1 Pro', 1048576, 0.24, 8.402],
  ['z-ai/glm-5.3', 'Z.ai: GLM 5.3', 1048576, 0.07, 1.4], ['z-ai/glm-5.3-flash', 'Z.ai: GLM 5.3 Flash', 1048576, 0.04, 0.078],
  ['mistralai/mistral-large-4-0', 'Mistral: Mistral Large 4', 1048576, 0.7, 2.1], ['meta/muse-spark-1.3', 'Meta: Muse Spark 1.3', 1048576, 1.25, 4.25],
  ['meta/muse-ember', 'Meta: Muse Ember', 1048576, 0.1, 0.5], ['anthropic/claude-fable-5.2', 'Anthropic: Claude Fable 5.2', 1000000, 8, 40],
  ['anthropic/claude-haiku-5.5', 'Anthropic: Claude Haiku 5.5', 1000000, 0.1, 0.5], ['openai/gpt-6.2-astra', 'OpenAI: GPT-6.2 Astra', 1050000, 8, 40],
  ['openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', 1050000, 0.1, 0.5], ['google/gemini-4-carbon', 'Google: Gemini 4 Carbon', 1048576, 2, 10], ['x-ai/grok-4.6', 'SpaceXAI: Grok 4.6', 500000, 2, 6],
  ['qwen/qwen3.8-max-prime', 'Qwen: Qwen3.8 Max Prime', 1000000, 4, 12],
].map(([id, name, context, input, output], index) => ({
  id, name, created: NOW + index, context_length: context, pricing: { prompt: String(Number(input) / 1e6), completion: String(Number(output) / 1e6) }, architecture: { output_modalities: ['text'] },
}))
const EXTRA = Math.max(0, Number(process.env.FAKE_OPENROUTER_COUNT ?? 0) - OPENROUTER.length)
OPENROUTER.push(...Array.from({ length: EXTRA }, (_, index) => ({ id: `fake/model-${index}`, name: `Fake model ${index}`, created: NOW - index, context_length: 128000, pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { output_modalities: ['text'] } })))
const OPENAI = ['gpt-6.2-astra', 'gpt-6.2-astra-pro', 'gpt-6.2-sol', 'gpt-6.2-sol-pro', 'gpt-6.1-terra', 'gpt-6-luna-pro', 'dall-e-3', 'text-embedding-3-large', 'whisper-1', 'gpt-6.2-realtime-preview'].map((id, index) => ({ id, object: 'model', created: NOW + index, owned_by: 'fake' }))
const XAI = ['grok-4.7', 'grok-4.6', 'grok-build-0.1', 'grok-imagine-image'].map((id, index) => ({ id, object: 'model', created: NOW + index, owned_by: 'fake' }))
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
