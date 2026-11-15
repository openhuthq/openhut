import type { Audience, ChannelKind } from '@openhut/common/channels/channel.ts'
import type { AgentFiles } from '../platform/agentd.ts'
import { config } from '../platform/config.ts'
import { agentSubnet } from '../platform/network.ts'
import { slack } from '../integrations/slack/slack.ts'
import { telegram } from '../integrations/telegram/telegram.ts'
import { whatsapp } from '../integrations/whatsapp/whatsapp.ts'

const AUXILIARY_TASKS = ['approval', 'compression', 'title_generation', 'background_review']

export function renderFiles({ agent, ownerName, token, channelKey, seat, channels }: {
  agent: { id: string; name: string; instructions: string; model: string; net: number; code_execution: boolean }
  ownerName: string
  token: string
  channelKey: string
  seat: string
  channels: RenderedChannel[]
}): AgentFiles {
  const gateway = `http://${agentSubnet(agent.net)}.1:${config.gatewayPort}`
  const disabled = ['browser', 'delegation', 'cronjob', ...(agent.code_execution ? [] : ['code_execution'])]
  const yaml = [
    modelYaml({ gateway, token, model: agent.model }),
    'terminal:\n  backend: local',
    `agent:\n  api_max_retries: 30\n  disabled_toolsets: [${disabled.join(', ')}]`,
    'approvals:\n  mode: "off"',
    'platform_toolsets:\n  api_server: [hermes-api-server, openhut]',
    'tools:\n  tool_search:\n    enabled: "off"',
    `mcp_servers:\n  openhut:\n    url: ${gateway}/api/v1/mcp\n    headers:\n      Authorization: "Agent ${token}"`,
    ...channels.flatMap(yamlOf),
  ].join('\n') + '\n'
  const env = [
    `API_SERVER_KEY=${channelKey}`, 'API_SERVER_HOST=0.0.0.0', 'API_SERVER_PORT=8642',
    ...(config.modelMode === 'claude' && seat ? [`CLAUDE_CODE_OAUTH_TOKEN=${seat}`] : []),
    ...channels.flatMap(envOf),
  ].join('\n') + '\n'
  return { 'config.yaml': yaml, '.env': env, 'SOUL.md': `${agent.instructions}\n` }
}

function modelYaml({ gateway, token, model }: { gateway: string; token: string; model: string }): string {
  if (config.modelMode === 'test') {
    return `model:\n  default: openhut-test-${model}\n  provider: custom\n  base_url: ${gateway}/test-llm/v1\n  api_key: "${token}"\n  context_length: 200000`
  }
  const auxiliary = AUXILIARY_TASKS.map((task) => `  ${task}: { provider: claude-subscription-directsdk-experimental, model: haiku }`).join('\n')
  return `model:\n  default: ${model}\n  provider: claude-subscription-directsdk-experimental\nauxiliary:\n${auxiliary}`
}

function yamlOf(channel: RenderedChannel): string[] {
  switch (channel.kind) {
    case 'slack': return [slack.yaml.trimEnd()]
    case 'telegram': return [telegram.yaml.trimEnd()]
    case 'whatsapp': return []
  }
}

function envOf(channel: RenderedChannel): string[] {
  switch (channel.kind) {
    case 'slack': return slack.env({ botToken: channel.botToken, appToken: channel.appToken, audience: channel.audience })
    case 'telegram': return telegram.env({ botToken: channel.botToken, audience: channel.audience })
    case 'whatsapp': return whatsapp.env(channel.audience)
  }
}

export type RenderedChannel =
  | { kind: Extract<ChannelKind, 'slack'>; audience: Audience; botToken: string; appToken: string }
  | { kind: Extract<ChannelKind, 'telegram'>; audience: Audience; botToken: string }
  | { kind: Extract<ChannelKind, 'whatsapp'>; audience: Audience }
