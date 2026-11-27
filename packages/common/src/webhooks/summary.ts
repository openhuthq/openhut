import type { WebhookCallMeta } from './webhook.ts'

export type WebhookSeverity = 'critical' | 'warning' | 'info'
export type WebhookSummary = {
  title: string
  subtitle?: string
  severity?: WebhookSeverity
  fields: { label: string; value: string }[]
  link?: { label: string; url: string }
  event?: string
}

const MAX_FIELDS = 3
const MAX_VALUE = 200
const SEVERITIES: Record<string, WebhookSeverity> = {
  critical: 'critical', fatal: 'critical', emergency: 'critical', error: 'critical', high: 'critical',
  warning: 'warning', warn: 'warning', medium: 'warning',
  info: 'info', informational: 'info', notice: 'info', low: 'info', ok: 'info', resolved: 'info',
}
const GITHUB_KINDS = [['pull_request', 'Pull request'], ['issue', 'Issue'], ['release', 'Release'], ['workflow_run', 'Workflow run'], ['check_run', 'Check run'], ['comment', 'Comment']] as const
const EVENT_KEYS = ['event', 'type', 'event_type', 'eventType', 'action', 'kind', 'topic']
const TITLE_KEYS = ['title', 'name', 'subject', 'summary', 'message']

export function summarizeWebhook(payload: unknown): WebhookSummary {
  const body = objectOf(payload)
  if (!body) return { title: 'Webhook called', fields: typeof payload === 'string' && payload.trim() ? [{ label: 'Body', value: clip(payload.trim()) }] : [] }
  return digitalOcean(body) ?? gitHub(body) ?? generic(body)
}

function digitalOcean(body: Record<string, unknown>): WebhookSummary | undefined {
  const data = objectOf(body.data)
  const rule = text(data?.alert_rule_name) ?? text(data?.alert_name)
  if (!data || !rule) return undefined
  const state = text(data.state)
  const fields = [
    field('Value', text(data.value)),
    field('State', state && words(state.replace(/^STATE_/, ''))),
    field('Since', text(body.time) ?? text(data.time)),
  ]
  const resourceUrl = text(data.resource_url)
  return {
    title: rule,
    ...text(data.resource_name) && { subtitle: text(data.resource_name) },
    ...severityOf(text(data.severity)) && { severity: severityOf(text(data.severity)) },
    fields: fields.flatMap((each) => each ?? []).slice(0, MAX_FIELDS),
    ...resourceUrl && isUrl(resourceUrl) && { link: { label: 'Open in DigitalOcean', url: resourceUrl } },
    ...text(body.type) && { event: text(body.type) },
  }
}

function gitHub(body: Record<string, unknown>): WebhookSummary | undefined {
  const repo = objectOf(body.repository)
  const name = text(repo?.full_name)
  if (!repo || !name) return undefined
  const action = text(body.action)
  const sender = text(objectOf(body.sender)?.login)
  const found = GITHUB_KINDS.find(([key]) => objectOf(body[key]))
  const item = found && objectOf(body[found[0]])
  const kind = found?.[1]
  const fields = [
    field(kind ?? 'Event', action ? words(action) : undefined),
    field('By', sender),
    field('Conclusion', text(item?.conclusion)),
  ]
  const url = text(item?.html_url) ?? text(body.compare) ?? text(repo.html_url)
  return {
    title: gitHubTitle({ body, item, name, action }),
    subtitle: name,
    fields: fields.flatMap((each) => each ?? []).slice(0, MAX_FIELDS),
    ...url && isUrl(url) && { link: { label: 'Open in GitHub', url } },
    ...(kind || action) && { event: [kind?.toLowerCase().replace(/ /g, '_'), action].filter(Boolean).join('.') },
  }
}

function gitHubTitle({ body, item, name, action }: { body: Record<string, unknown>; item?: Record<string, unknown>; name: string; action?: string }): string {
  const itemTitle = text(item?.title) ?? text(item?.name)
  if (itemTitle) return typeof item?.number === 'number' ? `#${item.number} ${itemTitle}` : itemTitle
  const ref = text(body.ref)
  if (ref && Array.isArray(body.commits)) return `Pushed ${body.commits.length} ${body.commits.length === 1 ? 'commit' : 'commits'} to ${ref.replace(/^refs\/heads\//, '')}`
  return `${name} ${action ?? 'event'}`
}

function generic(body: Record<string, unknown>): WebhookSummary {
  const event = EVENT_KEYS.map((key) => text(body[key])).find(Boolean)
  const titleKey = TITLE_KEYS.find((key) => text(body[key]))
  const severity = severityOf(text(body.severity) ?? text(body.level) ?? text(body.priority) ?? text(body.status))
  const used = new Set([titleKey, ...EVENT_KEYS])
  const fields = Object.entries(body).flatMap(([key, value]) => {
    const shown = used.has(key) ? undefined : scalar(value)
    return shown === undefined ? [] : [{ label: words(key), value: clip(shown) }]
  }).slice(0, MAX_FIELDS)
  const url = Object.values(body).map(text).find((value) => value && isUrl(value))
  return {
    title: (titleKey && text(body[titleKey])) || (event ? words(event) : 'Webhook called'),
    ...severity && { severity },
    fields,
    ...url && { link: { label: 'Open link', url } },
    ...event && { event },
  }
}

function severityOf(value: string | undefined): WebhookSeverity | undefined {
  return value ? SEVERITIES[value.toLowerCase().replace(/^severity_/, '')] : undefined
}

function field(label: string, value: string | undefined): { label: string; value: string } | undefined {
  return value ? { label, value: clip(value) } : undefined
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'boolean' ? String(value) : text(value)
}

function words(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' ').trim().toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function isUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value)
}

const clip = (value: string): string => value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value

export type WebhookCall = { author: string; call: WebhookCallMeta; source: { kind: 'webhook'; id: string; name: string }; payload: unknown }
