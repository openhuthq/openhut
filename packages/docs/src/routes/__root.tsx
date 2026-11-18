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
      { name: 'theme-color', content: '#ffffff' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'OpenHut' },
      { property: 'og:title', content: 'OpenHut docs' },
      { property: 'og:description', content: 'OpenHut docs: install it on your server, build agents for your team, and keep them safe.' },
      { property: 'og:image', content: 'https://openhut.dev/og.jpg' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [{ rel: 'icon', href: '/docs/hut.svg' }, { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, { rel: 'manifest', href: '/site.webmanifest' }],
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
