import { defineCatalog, defineSchema } from '@json-render/core'
import { z } from 'zod'

const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(s.object({
      type: s.ref('catalog.components'),
      props: s.propsOf('catalog.components'),
      children: { ...s.array(s.string()), ...s.optional() },
    })),
  }),
  catalog: s.object({ components: s.map({ props: s.zod() }) }),
}))

const text = z.string().max(3000)
const cell = z.union([z.string().max(500), z.number()])

const components = {
  Card: { props: z.object({ title: z.string().max(150), subtitle: z.string().max(300).optional() }) },
  Text: { props: z.object({ content: text }) },
  Fields: { props: z.object({}) },
  Field: { props: z.object({ label: z.string().max(100), value: cell }) },
  Table: { props: z.object({ headers: z.array(z.string().max(100)).max(20), rows: z.array(z.array(cell).max(20)).max(100) }) },
  Chart: { props: z.object({ title: z.string().max(150), labels: z.array(z.string().max(50)).max(30), values: z.array(z.number()).max(30) }) },
  Image: { props: z.object({ url: z.url(), alt: z.string().max(300) }) },
  Divider: { props: z.object({}) },
  Actions: { props: z.object({}) },
  Button: { props: z.object({ id: z.string().max(50), label: z.string().max(75), style: z.enum(['primary', 'danger']).optional() }) },
  LinkButton: { props: z.object({ label: z.string().max(75), url: z.url() }) },
}

export const cardCatalog = defineCatalog(schema, { components })

const Spec = z.object({
  root: z.string(),
  elements: z.record(z.string(), z.object({ type: z.string(), props: z.record(z.string(), z.unknown()).default({}), children: z.array(z.string()).optional() })),
})

export function parseCard(value: unknown): CardSpec | undefined {
  const spec = Spec.safeParse(value).data
  if (!spec || spec.elements[spec.root]?.type !== 'Card') return undefined
  const valid = Object.values(spec.elements).every((element) => {
    const component = components[element.type as keyof typeof components]
    return component?.props.safeParse(element.props).success && (element.children ?? []).every((id) => id in spec.elements)
  })
  return valid ? spec : undefined
}

export type CardSpec = { root: string; elements: Record<string, CardElement> }
export type CardElement = { type: string; props: Record<string, unknown>; children?: string[] }

export const SPEC_BLOCK = /```spec\n([\s\S]*?)```/

export const CARD_PROMPT = `
## Cards

When structure helps the person (a status, numbers, a comparison, a choice), add one card to your reply. Write your normal sentences, then a \`\`\`spec block. At most one card per reply, and none for plain conversation.

Inside the block, write one JSON Patch per line: the root first, then each element. Containers list their children's ids.

\`\`\`spec
{"op":"add","path":"/root","value":"card"}
{"op":"add","path":"/elements/card","value":{"type":"Card","props":{"title":"Deploy #142 is ready"},"children":["facts","acts"]}}
{"op":"add","path":"/elements/facts","value":{"type":"Fields","props":{},"children":["f1","f2"]}}
{"op":"add","path":"/elements/f1","value":{"type":"Field","props":{"label":"Service","value":"billing-api"}}}
{"op":"add","path":"/elements/f2","value":{"type":"Field","props":{"label":"Tests","value":"312 passed"}}}
{"op":"add","path":"/elements/acts","value":{"type":"Actions","props":{},"children":["ok","logs"]}}
{"op":"add","path":"/elements/ok","value":{"type":"Button","props":{"id":"approve","label":"Approve","style":"primary"}}}
{"op":"add","path":"/elements/logs","value":{"type":"LinkButton","props":{"label":"Logs","url":"https://ci.example.com/142"}}}
\`\`\`

Components (props in braces):
- Card {title, subtitle?}: always the root.
- Text {content}: markdown.
- Fields, with Field {label, value} children.
- Table {headers: string[], rows: string[][]}
- Chart {title, labels: string[], values: number[]}: a bar chart.
- Image {url, alt}
- Divider {}
- Actions, with Button {id, label, style?: "primary" | "danger"} and LinkButton {label, url} children.

A Button sends its label back to you as the person's reply. Some chats can't show cards; they get a text version, so the card must make sense as text too.
`
