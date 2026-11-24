export async function attach(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const waiting = new Map()
  const urls = new Map()
  let id = 0
  const failures = []
  socket.onmessage = (message) => {
    const reply = JSON.parse(message.data)
    if (reply.method === 'Network.requestWillBeSent') urls.set(reply.params.requestId, `${reply.params.request.method} ${reply.params.request.url}`)
    if (reply.method === 'Network.loadingFailed' && !reply.params.canceled) failures.push({ request: urls.get(reply.params.requestId), error: reply.params.errorText, at: new Date().toISOString() })
    if (reply.method === 'Runtime.exceptionThrown' || (reply.method === 'Runtime.consoleAPICalled' && reply.params.type === 'error')) failures.push({ console: JSON.stringify(reply.params).slice(0, 400) })
    waiting.get(reply.id)?.(reply)
    waiting.delete(reply.id)
  }
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id
    waiting.set(n, (reply) => reply.error ? reject(new Error(reply.error.message)) : resolve(reply.result))
    socket.send(JSON.stringify({ id: n, method, params }))
    setTimeout(() => waiting.has(n) && (waiting.delete(n), reject(new Error(`no answer to ${method}`))), 60_000)
  })
  await send('Network.enable', {})
  await send('Runtime.enable', {})
  return {
    failures,
    send,
    close: () => socket.close(),
    eval: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page error')
      return result.result?.value
    },
  }
}

export async function typeInto({ page, selector, text }) {
  const focused = await page.eval(`(() => { const box = document.querySelector(${JSON.stringify(selector)}); if (!box || box.disabled) return false; box.focus(); return true })()`)
  if (!focused) return false
  await page.send('Input.insertText', { text })
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...type === 'keyDown' && { text: '\r' } })
  return true
}

export async function clickText({ page, text, selector = 'button, a, [role="button"], [role="menuitem"], label' }) {
  return page.eval(`(() => { const hit = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => each.textContent.trim() === ${JSON.stringify(text)} && !each.disabled); hit?.click(); return Boolean(hit) })()`)
}
