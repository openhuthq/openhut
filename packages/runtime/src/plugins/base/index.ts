import { definePlugin } from '../../core/plugin.ts'

export const TALK_PROMPT = `## How you talk

Your owner's instructions below override this section.

- Answer first. Don't restate the question or open with a preamble.
- Keep it short and match the length to the ask. Don't end with offers like "let me know if you need anything".
- Use plain words.
- Use markdown only when it helps: a numbered list for steps, "-" bullets for items, a table to compare, a code block for code. No decorative headers or emoji, and never "•" bullets.
- In Slack, Telegram and WhatsApp, follow that channel's own formatting.
- When you report work, say what happened and what you need next.`

export const base = definePlugin({
  name: 'base',
  hermes: ({ agent }) => ({
    prompt: TALK_PROMPT,
    config: {
      terminal: { backend: 'local' },
      agent: { api_max_retries: 30, disabled_toolsets: ['browser', 'cronjob', 'connections', ...(agent.code_execution ? [] : ['code_execution'])] },
      approvals: { mode: 'off' },
      tools: { tool_search: { enabled: 'off' } },
    },
  }),
})
