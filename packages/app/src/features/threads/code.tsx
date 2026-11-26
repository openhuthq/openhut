import { Fragment, useEffect, useState } from 'react'
import type { ExtraProps } from 'react-markdown'
import type { HighlighterCore, ThemedToken } from 'shiki/core'
import { CopyButton } from '@/components/copy-button'

type Lit = { code: string; lines: ThemedToken[][] }

let shiki: Promise<HighlighterCore> | undefined

const highlighter = () => shiki ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript'), import('shiki/themes/github-light.mjs')])
  .then(([core, engine, theme]) => core.createHighlighterCore({ themes: [theme.default], langs: [], engine: engine.createJavaScriptRegexEngine() }))

async function tokens({ code, lang }: { code: string; lang: string }): Promise<ThemedToken[][] | undefined> {
  const [found, { bundledLanguages }] = await Promise.all([highlighter(), import('shiki/langs')])
  const grammar = bundledLanguages[lang as keyof typeof bundledLanguages]
  if (!grammar) return undefined
  await found.loadLanguage(grammar)
  return found.codeToTokensBase(code, { lang, theme: 'github-light' })
}

function fenceOf(node: ExtraProps['node']) {
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code')
  if (code?.type !== 'element') return { code: '', lang: '' }
  const classes = code.properties.className
  const lang = Array.isArray(classes) ? String(classes.find((each) => String(each).startsWith('language-')) ?? '').slice(9) : ''
  const text = code.children.map((child) => child.type === 'text' ? child.value : '').join('')
  return { code: text.replace(/\n$/, ''), lang: lang.toLowerCase() }
}

export function CodeBlock({ node }: ExtraProps) {
  const { code, lang } = fenceOf(node)
  const [lit, setLit] = useState<Lit>()
  useEffect(() => {
    if (!lang) return
    let current = true
    tokens({ code, lang }).then((lines) => { if (current && lines) setLit({ code, lines }) }, () => {})
    return () => { current = false }
  }, [code, lang])
  const ready = lit && code.startsWith(lit.code) ? lit : undefined
  return <div className="code-block">
    <div className="code-head">
      <span>{lang}</span>
      <CopyButton text={code} label="Copy" variant="ghost" className="text-mute not-disabled:hover:text-ink" />
    </div>
    <pre><code>{ready
      ? <>{ready.lines.map((line, index) => <Fragment key={index}>{index > 0 && '\n'}{line.map((token, at) => <span key={at} style={{ color: token.color }}>{token.content}</span>)}</Fragment>)}{code.slice(ready.code.length)}</>
      : code}</code></pre>
  </div>
}
