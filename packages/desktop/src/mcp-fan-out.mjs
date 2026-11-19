const COMPUTER = { type: 'string', description: 'Which computer to run this on: a name or id from list_computers. Leave it out for this computer.' }
const LIST_COMPUTERS = { name: 'list_computers', description: 'The computers OpenHut reaches, and whether each is online. Pass one\'s name as computer to any other tool.', inputSchema: { type: 'object', properties: {} } }

export function fanOut({ local, computers, post }) {
  const on = async ({ computer, msg }) => answerOf({ msg, res: await post({ computer, msg }) })
  const route = async (msg) => {
    if (msg.method === 'tools/list') return withComputers(await on({ computer: local, msg }))
    if (msg.method !== 'tools/call') return on({ computer: local, msg })
    if (msg.params?.name === 'list_computers') return toolText({ id: msg.id, text: JSON.stringify((await computers()).map(({ id, name, online }) => ({ id, name, online })), null, 2) })
    const { computer: wanted, ...args } = msg.params?.arguments ?? {}
    const computer = wanted === undefined ? local : (await computers()).find((each) => each.id === wanted || each.name.toLowerCase() === String(wanted).toLowerCase())?.id
    if (!computer) return toolText({ id: msg.id, text: `There's no computer called ${wanted}. List the computers to see their names.`, isError: true })
    return on({ computer, msg: { ...msg, params: { ...msg.params, arguments: args } } })
  }
  return async (body) => {
    const msg = parse(body)
    if (!msg) return failure({ id: null, code: -32700, message: 'OpenHut couldn\'t read that message as JSON.' })
    return route(msg).catch((error) => failure({ id: msg.id, message: error.message }))
  }
}

async function answerOf({ msg, res }) {
  if (res.status === 202) return undefined
  const body = parse(await res.text())
  if (res.ok && body) return body
  return failure({ id: msg.id, message: body?.error?.message ?? `OpenHut answered ${res.status}. Try again, or open the OpenHut app.` })
}

function withComputers(answer) {
  if (!answer?.result?.tools) return answer
  const tools = answer.result.tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema?.properties, computer: COMPUTER } } }))
  return { ...answer, result: { ...answer.result, tools: [LIST_COMPUTERS, ...tools] } }
}

function toolText({ id, text, isError = false }) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError } }
}

function failure({ id, code = -32603, message }) {
  return id === undefined ? undefined : { jsonrpc: '2.0', id, error: { code, message } }
}

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
