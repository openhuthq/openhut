import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import '@/styles/app.css'
import { Search } from '@/components/search'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'OpenHut docs' },
      { name: 'description', content: 'OpenHut docs: install it on your server, build agents for your team, and keep them safe.' },
    ],
    links: [{ rel: 'icon', href: '/docs/hut.svg' }],
    scripts: [{ src: 'https://cdn.databuddy.cc/databuddy.js', async: true, 'data-client-id': '40a6e1dc-4e64-4fd6-8b92-415a77397465', 'data-track-web-vitals': '', 'data-track-errors': '' }],
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
