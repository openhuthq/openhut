import { request } from 'node:http'
import { createInterface } from 'node:readline'

export async function bridge({ sock, path, down, input = process.stdin, output = process.stdout }) {
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue
    const answer = await post({ sock, path, line }).catch(() => undefined)
    if (!answer) output.write(failure({ line, message: `${down}. Open the OpenHut app, then try again.` }))
    else if (answer.status >= 400) output.write(failure({ line, message: `OpenHut answered ${answer.status}. Try again, or open the OpenHut app.` }))
    else for (const each of answer.body.split('\n').filter((row) => row.trim() && !/^(event|id):/.test(row))) output.write(`${each.replace(/^data: /, '')}\n`)
  }
}

function post({ sock, path, line }) {
  return new Promise((resolve, reject) => {
    const out = request({ socketPath: sock, path, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (res) => {
      let body = ''
      res.setEncoding('utf8').on('data', (chunk) => { body += chunk }).on('end', () => resolve({ status: res.statusCode, body }))
    })
    out.on('error', reject)
    out.end(line)
  })
}

function failure({ line, message }) {
  const id = /"id"\s*:\s*("[^"]*"|\d+)/.exec(line)?.[1]
  return id ? `${JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(id), error: { code: -32603, message } })}\n` : ''
}
