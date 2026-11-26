import { secretPlaceholder } from '@openhut/common/agents/secret.ts'
import { definePlugin } from '../../core/plugin.ts'

export const keys = definePlugin({
  name: 'keys',
  hermes: ({ secrets }) => ({
    prompt: keysNote(secrets),
    env: Object.fromEntries(secrets.map(({ name }) => [`OPENHUT_SECRET_${name}`, secretPlaceholder(name)])),
  }),
})

function keysNote(secrets: { name: string; hosts: string[] }[]): string {
  if (!secrets.length) return ''
  const [first] = secrets
  return `## Keys

Your owner saved these keys for you: ${secrets.map(({ name, hosts }) => `${name} (only sent to ${hosts.join(', ')})`).join('; ')}. You never see them.
To call https://${first.hosts[0]}/some/path, call $OPENHUT_GATEWAY/x/${first.hosts[0]}/some/path with the header "Authorization: Agent $OPENHUT_AGENT_TOKEN": OpenHut adds the key on its way out, in the header your owner set for it. Never put $OPENHUT_SECRET_<NAME> (a stand-in) in the URL or another header: the gateway refuses it. Need another key? Ask with add_secret.`
}
