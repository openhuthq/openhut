import { compileSpecStream } from '@json-render/core'
import { parseCard, SPEC_BLOCK, type CardSpec } from '@openhut/common/cards/card.ts'
import type { GatewayAgent } from '../agents/agent-service.ts'
import { channelService } from '../channels/channel-service.ts'
import { barsText, slackBlocks, tableText } from '../integrations/slack/slack-card.ts'
import { slack } from '../integrations/slack/slack.ts'
import { log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'

const BROKEN = 'I tried to show this as a card, but the card was malformed.'

export const cardService = {
  async render({ agent, text, channel, chatId, threadId }: { agent: GatewayAgent; text: string; channel: string; chatId?: string; threadId?: string }): Promise<{ text: string }> {
    const block = SPEC_BLOCK.exec(text)
    if (!block) return { text }
    const card = parseCard(compiled(block[1]))
    const rest = text.replace(block[0], '').replace(/\n{3,}/g, '\n\n').trim()
    if (!card) return { text: rest || BROKEN }
    if (channel === 'slack' && chatId && await postedToSlack({ agent, card, chatId, threadId })) return { text: rest || cardText(card).split('\n')[0] }
    return { text: text.replace(block[0], cardText(card)).trim() }
  },
}

export function cardText(card: CardSpec): string {
  const walk = (id: string): string[] => {
    const element = card.elements[id]
    if (!element) return []
    const props = element.props
    const children = () => (element.children ?? []).flatMap(walk)
    switch (element.type) {
      case 'Card': return [`**${props.title}**`, ...(props.subtitle ? [String(props.subtitle)] : []), ...children()]
      case 'Text': return [String(props.content)]
      case 'Field': return [`${props.label}: ${props.value}`]
      case 'Fields': return children()
      case 'Table': return [`\`\`\`\n${tableText(props)}\n\`\`\``]
      case 'Chart': return [String(props.title), `\`\`\`\n${barsText(props)}\n\`\`\``]
      case 'Image': return [`${props.alt}: ${props.url}`]
      case 'LinkButton': return [`${props.label}: ${props.url}`]
      case 'Connect': return [`${props.title}${props.subtitle ? ` · ${props.subtitle}` : ''}: ${props.url}`]
      case 'Actions': return actionsText(card, element.children ?? [])
      default: return []
    }
  }
  return walk(card.root).join('\n')
}

function actionsText(card: CardSpec, ids: string[]): string[] {
  const elements = ids.flatMap((id) => card.elements[id] ?? [])
  const choices = elements.filter((element) => element.type === 'Button').map((element) => String(element.props.label))
  const links = elements.filter((element) => element.type === 'LinkButton').map((element) => `${element.props.label}: ${element.props.url}`)
  return [...(choices.length ? [`Reply with: ${choices.join(' / ')}`] : []), ...links]
}

function compiled(jsonl: string): unknown {
  try { return compileSpecStream(jsonl) } catch { return undefined }
}

async function postedToSlack({ agent, card, chatId, threadId }: { agent: GatewayAgent; card: CardSpec; chatId: string; threadId?: string }): Promise<boolean> {
  const botToken = await channelService.slackToken({ agentId: agent.id })
  if (!botToken) return false
  return slack.postCard({ botToken, channel: chatId, threadTs: threadId, blocks: slackBlocks(card), text: cardText(card) }).catch((err: unknown) => {
    log.warn({ event: 'card.slack_failed', agent: agent.id, error: messageOf(err) })
    return false
  })
}
