import { createElement } from 'react'
import { loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'
import { PageIcon } from '@/components/icons'

export const docs = defineDocs({ dir: 'content/docs', docs: { async: true } })

const icon = <T extends { icon?: unknown }>(node: T): T =>
  typeof node.icon === 'string' ? { ...node, icon: createElement(PageIcon, { icon: node.icon }) } : node

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: '/',
  plugins: [{ name: 'box:icons', transformPageTree: { file: icon, folder: icon, separator: icon } }],
})
