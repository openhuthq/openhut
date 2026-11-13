import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="brand"><img src="/docs/monkey.svg" alt="" width={30} height={30} />Fast Monkey<span>docs</span></span>,
      url: '/',
    },
    links: [{ text: 'Site', url: 'https://fastmonkey.dev', external: true }, { text: 'Brand', url: 'https://fastmonkey.dev/brand', external: true }],
    githubUrl: 'https://github.com/abuaboud/fastmonkey',
    themeSwitch: { enabled: false },
  }
}
