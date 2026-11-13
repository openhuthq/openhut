import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import '@/styles/app.css'
import { Search } from '@/components/search'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Fast Monkey docs' },
      { name: 'description', content: 'Fast Monkey docs: install it on your server, build agents for your team, and keep them safe.' },
    ],
    links: [{ rel: 'icon', href: '/docs/monkey.svg' }],
  }),
  component: Root,
})

function Root() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ SearchDialog: Search }} theme={{ enabled: false }}>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
