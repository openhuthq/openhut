import { clickText, typeInto } from '../cdp.mjs'
import { setTimeout as sleep } from 'node:timers/promises'
import { signIn } from '../dev-cloud.mjs'

const textOf = async (page) => String(await page.eval('document.body?.innerText ?? ""'))

export async function flows({ runtime, window, shot, until, say, api }) {
  const showing = (page, pattern, what) => until(async () => pattern.test(await textOf(page)), 30, `${page.runtime.name}: ${what}`)
  const click = async (page, text) => {
    await until(() => clickText({ page, text }), 15, `${page.runtime.name}: the "${text}" button`)
  }

  const mo = await runtime('mo')
  const moApp = await window(mo)
  await showing(moApp, /Continue with Google/, 'the sign-in screen')
  await shot({ page: moApp, name: '01-first-launch-sign-in', step: 'first launch: sign in' })

  await signIn({ page: moApp, api, kit: false })
  await showing(moApp, /recovery kit/i, 'the recovery kit screen')
  await shot({ page: moApp, name: '02-kit-save', step: 'sign in done: save the recovery kit' })
  const saveKit = async (page, screen) => {
    await click(page, 'Copy')
    await showing(page, /stored it somewhere safe/, 'the "stored it" check')
    if (screen) await shot({ page, name: screen, step: 'kit copied: confirm it is stored' })
    await click(page, 'I’ve stored it somewhere safe')
    await click(page, 'Done')
  }
  await saveKit(moApp, '03-kit-copied')
  await showing(moApp, /Make your first agent/, 'the first agent card')
  await shot({ page: moApp, name: '04-first-agent', step: 'kit saved: make your first agent' })
  await click(moApp, 'Create agent')
  const agent = await until(async () => (await (await mo.api('/api/agents')).json()).data?.[0], 30, 'the first agent')
  await until(async () => {
    const now = await (await mo.api(`/api/agents/${agent.id}`)).json()
    return now.status === 'running' && now.health === 'answering'
  }, 90, `${agent.name} to answer`)
  await moApp.eval(`navigation.navigate('/agents/${agent.id}')`)
  await shot({ page: moApp, name: '05-first-agent-ready', step: `${agent.name} runs and answers` })
  await until(() => typeInto({ page: moApp, selector: 'textarea[aria-label="Message"]', text: 'hello from mo' }), 30, 'the chat box')
  await showing(moApp, /ECHO/, `${agent.name}'s answer`)
  await shot({ page: moApp, name: '06-first-chat', step: `first chat with ${agent.name}` })

  const shared = await (await mo.api(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ shared: true }) })).json()
  if (!shared.shared) throw new Error(`sharing ${agent.name} answered ${JSON.stringify(shared)}`)
  const team = (await (await mo.api('/api/cloud')).json()).workspaces.find((each) => each.home)
  const invite = await (await mo.api('/api/invitations/cloud', { method: 'POST', body: JSON.stringify({ workspace: team.id, email: 'sara@example.com', role: 'member' }) })).json()
  if (!invite.link) throw new Error(`inviting sara answered ${JSON.stringify(invite)}`)
  await moApp.eval("navigation.navigate('/settings/people')")
  await showing(moApp, /sara@example\.com/, 'sara in the People list')
  await shot({ page: moApp, name: '07-invite-sent', step: 'Mo invited sara@example.com' })

  const sara = await runtime('sara')
  const saraApp = await window(sara, `/join${new URL(invite.link).hash}`)
  await showing(saraApp, /You.re invited|Join /, 'the invite join card')
  await shot({ page: saraApp, name: '08-invite-join-card', step: 'sara opens the invite link' })
  await signIn({ page: saraApp, api, email: 'sara@example.com', kit: false })
  await saraApp.eval(`navigation.navigate(${JSON.stringify(`/join${new URL(invite.link).hash}`)})`)
  await until(() => clickText({ page: saraApp, text: 'Join team' }), 30, 'sara: Join team')
  await showing(saraApp, /You.re in/, 'You’re in')
  await shot({ page: saraApp, name: '09-invite-youre-in', step: 'sara joined Mo’s team', settle: 0 })
  await showing(saraApp, /recovery kit/i, 'sara: the recovery kit screen')
  await saveKit(saraApp)
  await until(async () => (await (await sara.api('/api/agents')).json()).data?.some((each) => each.id === agent.id), 60, `sara: Mo's shared ${agent.name}`)
  await saraApp.eval(`navigation.navigate('/agents/${agent.id}')`)
  await until(() => typeInto({ page: saraApp, selector: 'textarea[aria-label="Message"]', text: 'hello from sara' }), 30, 'sara: the chat box')
  await showing(saraApp, /ECHO: .*hello from sara/, `${agent.name}'s answer to sara`)
  await shot({ page: saraApp, name: '10-teammate-chats-shared-agent', step: `sara chats with Mo's shared ${agent.name}` })
}
