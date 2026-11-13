import defaultMdxComponents from 'fumadocs-ui/mdx'
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock'
import Link from 'fumadocs-core/link'
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import type { MDXComponents } from 'mdx/types'
import { Fragment, type ComponentProps, type ReactNode } from 'react'
import { Agents, Arrow, Ico, Logo, isIcoName, type IcoName } from '@/components/icons'

const PROMPT_ICONS: Record<string, ReactNode> = { 'Say to your agent': <Agents />, 'Say to Claude': <Logo name="claude" size={16} /> }

export function useMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Accordion, Accordions, Step, Steps, Tab, Tabs, Card, Logo, Shot, Ico, Flow, pre, ...components } satisfies MDXComponents
}

function Card({ ico, logo, title, href, children }: { ico?: IcoName; logo?: string; title: string; href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="card not-prose">
      {ico && <Ico name={ico} size={22} tile />}
      {logo && <Logo name={logo} />}
      <span className="grid gap-0.5">
        <span className="text-sm font-medium text-fd-foreground">{title}</span>
        {children && <span className="text-sm text-fd-muted-foreground">{children}</span>}
      </span>
    </Link>
  )
}

function pre(props: ComponentProps<typeof CodeBlock>) {
  return (
    <CodeBlock {...props} icon={PROMPT_ICONS[String(props.title)] ?? props.icon}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
  )
}

function Flow({ steps }: { steps: [string, string][] }) {
  return (
    <div className="flow not-prose">
      {steps.map(([icon, label], i) => (
        <Fragment key={label}>
          {i > 0 && <Arrow />}
          <span className="step">
            {isIcoName(icon) ? <Ico name={icon} size={22} tile /> : <Logo name={icon} />}
            <span>{label}</span>
          </span>
        </Fragment>
      ))}
    </div>
  )
}

function Shot({ src, alt }: { src: string; alt: string }) {
  return <img src={`/docs/screenshots/${src}.jpg`} alt={alt} className="shot" loading="lazy" />
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof useMDXComponents>
}
