export function slackManifest(name: string) {
  const display = name.slice(0, 35)
  return {
    _metadata: { major_version: 1, minor_version: 1 },
    display_information: { name: display, description: `${display}, a Fast Monkey agent`.slice(0, 140), background_color: '#1a1a2e' },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: display, always_online: true },
      assistant_view: { assistant_description: `Chat with ${display} in threads and DMs.` },
    },
    oauth_config: {
      scopes: {
        bot: ['app_mentions:read', 'assistant:write', 'channels:history', 'channels:read', 'chat:write', 'files:read', 'files:write', 'groups:history', 'groups:read',
          'im:history', 'im:read', 'im:write', 'mpim:history', 'mpim:read', 'reactions:read', 'users:read'],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ['app_mention', 'assistant_thread_context_changed', 'assistant_thread_started', 'message.channels', 'message.groups', 'message.im', 'message.mpim',
          'reaction_added', 'reaction_removed'],
      },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  }
}

export const slackCreateUrl = (name: string) => `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(name)))}`
