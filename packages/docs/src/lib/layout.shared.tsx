import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="brand"><img src="/docs/hut.svg" alt="" width={30} height={30} />OpenHut<span>docs</span></span>,
      url: '/',
    },
    links: [{ text: 'Site', url: 'https://openhut.dev', external: true }, { text: 'Brand', url: 'https://openhut.dev/brand', external: true }, { text: 'Changelog', url: 'https://openhut.dev/changelog', external: true }],
    githubUrl: 'https://github.com/openhuthq/openhut',
    themeSwitch: { enabled: false },
  }
}
