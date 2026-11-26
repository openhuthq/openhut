import { INTERVIEW_PROMPT, isStarter } from '@openhut/common/asks/ask.ts'
import { definePlugin } from '../../core/plugin.ts'

export const onboarding = definePlugin({
  name: 'onboarding',
  hermes: ({ agent }) => ({ prompt: isStarter(agent) ? INTERVIEW_PROMPT : '' }),
})
