import type { CardElement, CardSpec } from '@openhut/common/cards/card.ts'

type Block = Record<string, unknown>

const MAX_BLOCKS = 50
const BAR = 20

export function slackBlocks(card: CardSpec): Block[] {
  let tables = 0
  const walk = (id: string): Block[] => {
    const element = card.elements[id]
    if (!element) return []
    const props = element.props
    const children = () => (element.children ?? []).flatMap(walk)
    switch (element.type) {
      case 'Card': return [
        { type: 'header', text: plain(String(props.title)) },
        ...(props.subtitle ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: String(props.subtitle) }] }] : []),
        ...children(),
      ]
      case 'Text': return [section(mrkdwn(String(props.content)))]
      case 'Field': return [section(fieldText(props))]
      case 'Fields': return [{ type: 'section', fields: kids(card, element).map((field) => ({ type: 'mrkdwn', text: fieldText(field.props) })).slice(0, 10) }]
      case 'Table': return tables++ ? [section(`\`\`\`${tableText(props)}\`\`\``)] : [tableBlock(props)]
      case 'Chart': return [section(`*${props.title}*\n\`\`\`${barsText(props)}\`\`\``)]
      case 'Image': return [{ type: 'image', image_url: props.url, alt_text: props.alt }]
      case 'Divider': return [{ type: 'divider' }]
      case 'Connect': return [{ ...section(`*${props.title}*${props.subtitle ? ` · ${props.subtitle}` : ''}`), accessory: { type: 'button', text: plain('Connect'), action_id: `card-link:${id}`, url: props.url } }]
      case 'Actions': return [{ type: 'actions', elements: (element.children ?? []).flatMap((child) => button(child, card.elements[child])).slice(0, 25) }]
      default: return []
    }
  }
  return walk(card.root).slice(0, MAX_BLOCKS)
}

export function barsText(props: Record<string, unknown>): string {
  const labels = props.labels as string[]
  const values = props.values as number[]
  const top = Math.max(...values.map(Math.abs), 1)
  const width = Math.max(...labels.map((label) => label.length))
  return labels.map((label, i) => `${label.padEnd(width)}  ${'█'.repeat(Math.round((Math.abs(values[i] ?? 0) / top) * BAR))} ${values[i] ?? ''}`).join('\n')
}

export function tableText(props: Record<string, unknown>): string {
  return [props.headers as string[], ...(props.rows as (string | number)[][])].map((row) => row.join(' | ')).join('\n')
}

function button(id: string, element: CardElement | undefined): Block[] {
  if (element?.type === 'Button') return [{ type: 'button', text: plain(String(element.props.label)), action_id: `card:${id}`, value: String(element.props.label), ...(element.props.style ? { style: element.props.style } : {}) }]
  if (element?.type === 'LinkButton') return [{ type: 'button', text: plain(String(element.props.label)), action_id: `card-link:${id}`, url: element.props.url }]
  return []
}

function tableBlock(props: Record<string, unknown>): Block {
  const rows = [props.headers as string[], ...(props.rows as (string | number)[][])]
  return { type: 'table', rows: rows.map((row) => row.map((cell) => ({ type: 'raw_text', text: String(cell) }))) }
}

const kids = (card: CardSpec, element: CardElement) => (element.children ?? []).flatMap((id) => card.elements[id] ?? [])
const fieldText = (props: Record<string, unknown>) => `*${props.label}*\n${props.value}`
const plain = (text: string) => ({ type: 'plain_text', text: text.slice(0, 150) })
const section = (text: string): Block => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 3000) } })
const mrkdwn = (markdown: string) => markdown.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<$2|$1>')
