import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { use } from 'react'
import { docs, source } from '@/lib/source'
import { baseOptions } from '@/lib/layout.shared'
import { useMDXComponents } from '@/components/mdx'
import { PageIcon } from '@/components/icons'

export const Route = createFileRoute('/$')({
  component: Page,
  loader: async ({ params }) => {
    const page = source.getPage(params._splat?.split('/').filter(Boolean) ?? [])
    if (!page) throw notFound()
    await docs.getPage(page.path)?.preload()
    return { path: page.path, url: page.url, title: page.data.title, description: page.data.description ?? '', icon: typeof page.data.icon === 'string' ? page.data.icon : null }
  },
  head: ({ loaderData }) => loaderData ? { meta: [{ title: `${loaderData.title} · Fast Monkey docs` }, { name: 'description', content: loaderData.description }] } : {},
})

function Page() {
  const { path, icon } = Route.useLoaderData()
  const page = docs.getPage(path)
  if (!page) throw notFound()
  const { toc } = use(page.load())
  const MDX = page.body
  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()}>
      <DocsPage toc={toc}>
        {icon && <PageIcon icon={icon} big />}
        <DocsTitle>{page.title}</DocsTitle>
        <DocsDescription>{page.description}</DocsDescription>
        <DocsBody>
          <MDX components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    </DocsLayout>
  )
}
