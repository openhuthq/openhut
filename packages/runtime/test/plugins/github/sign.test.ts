import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BODY_TOOLS, MARK, signed, signingOf, threadOf } from '../../../src/plugins/github/sign.ts'

const FACE = 'https://dl.openhut.dev/a/abc.png'

test('the footer names the agent, shows its face and links only to openhut.dev', () => {
  const body = signed({ body: 'Adds an index.', name: 'Database', face: FACE })
  assert.equal(body, `Adds an index.\n\n${MARK}\n---\n<sub><img src="${FACE}" width="16" height="16" align="top" alt=""> Opened by <b>Database</b>, an AI agent · Made with <a href="https://openhut.dev/?ref=gh">OpenHut</a></sub>`)
  assert.equal(signed({ body: '', name: 'Database', face: null }).startsWith(`${MARK}\n---\n<sub>Opened by <b>Database</b>`), true)
  assert.match(signed({ body: '', name: '<script>', face: null }), /<b>&#60;script&#62;<\/b>/)
})

test('signing twice keeps one footer, the agent\'s template stays and the body fits GitHub\'s limit', () => {
  const template = '## What changed\n\n- [x] Tests\n\n<!-- keep -->'
  const once = signed({ body: template, name: 'Database', face: FACE })
  assert.equal(signed({ body: once, name: 'Database', face: FACE }), once)
  assert.ok(once.startsWith(template))
  assert.equal(signed({ body: `${once}\n\nedited`, name: 'Database', face: FACE }).split(MARK).length, 2)
  assert.ok(signed({ body: 'x'.repeat(70_000), name: 'Database', face: FACE }).length <= 65_000)
})

test('PRs and issues are signed, an update with no body is left alone, review comments never are', () => {
  assert.deepEqual(BODY_TOOLS, ['create_pull_request', 'update_pull_request', 'issue_write', 'add_issue_comment'])
  assert.equal(signingOf({ tool: 'create_pull_request', args: {} }), 'sign')
  assert.equal(signingOf({ tool: 'update_pull_request', args: { title: 'x' } }), 'leave')
  assert.equal(signingOf({ tool: 'update_pull_request', args: { body: 'x' } }), 'sign')
  assert.equal(signingOf({ tool: 'issue_write', args: { method: 'create' } }), 'sign')
  assert.equal(signingOf({ tool: 'issue_write', args: { method: 'update', state: 'closed' } }), 'leave')
  assert.equal(signingOf({ tool: 'add_issue_comment', args: { body: 'x' } }), 'first_comment')
  for (const tool of ['add_comment_to_pending_review', 'add_reply_to_pull_request_comment', 'pull_request_review_write', 'update_issue_comment']) assert.equal(signingOf({ tool, args: { body: 'x' } }), 'leave')
  assert.equal(threadOf({ owner: 'Acme', repo: 'App', issue_number: 7 }), 'acme/app#7')
})
