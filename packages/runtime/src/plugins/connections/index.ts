import { definePlugin } from '../../core/plugin.ts'

export const connections = definePlugin({
  name: 'connections',
  hermes: ({ connections: list }) => ({ prompt: connectedApps(list) }),
})

function connectedApps(list: { name: string; kind: string }[]): string {
  if (!list.length) return ''
  const apps = list.map(({ name, kind }) => {
    const plain = name.replace(/\s+/g, ' ').trim()
    return plain.toLowerCase() === kind ? plain : `${plain} (${kind})`
  })
  return `## Connected apps\n\nThe openhut tools reach: ${apps.join(', ')}. Call list_tools to see what each one does, and use it before doing the same work by hand.`
}
