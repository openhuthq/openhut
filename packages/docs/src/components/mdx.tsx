import defaultMdxComponents from 'fumadocs-ui/mdx'
import Link from 'fumadocs-core/link'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import type { MDXComponents } from 'mdx/types'
import type { ReactNode } from 'react'
import { PageIcon } from '@/components/icons'

export function useMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Step, Steps, Card, Shot, ...components } satisfies MDXComponents
}

function Card({ icon, title, href, children }: { icon: string; title: string; href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="card not-prose">
      <PageIcon icon={icon} size={40} />
      <span className="grid gap-0.5">
        <span className="card-title">{title}</span>
        {children && <span className="card-text">{children}</span>}
      </span>
    </Link>
  )
}

function Shot({ src, alt }: { src: string; alt: string }) {
  return <span className="stage not-prose"><img src={`/docs/screenshots/${src}.jpg`} alt={alt} loading="lazy" /></span>
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof useMDXComponents>
}
