import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homePathsIn, linkHomeFiles, type MdNode } from '../../../src/features/threads/files.ts'

test('finds bare home paths with an extension in plain text, without trailing punctuation', () => {
  const text = [
    'I saved it to /opt/data/home/report.csv.',
    'Also ~/out/summary.md, and (see /opt/data/home/archive.tar.gz)',
    'The chart is at "/opt/data/home/chart.png"; done!',
    'Saved /opt/data/home/report.csv again.',
  ].join('\n')
  assert.deepEqual(homePathsIn(text), ['/opt/data/home/report.csv', '~/out/summary.md', '/opt/data/home/archive.tar.gz', '/opt/data/home/chart.png'])
})

test('ignores folders, paths outside the home, traversal, URLs and paths glued to other text', () => {
  const text = [
    'Your files live in /opt/data/home/projects and ~/notes/',
    'Not these: /etc/passwd, /opt/data/.env, /opt/data/home/../.env, ~/../config.yaml',
    'https://example.com/opt/data/home/x.csv and foo/opt/data/home/y.csv and `/opt/data/home/z.csv`',
    'Version 1.2 of ~ is fine, ~/.',
  ].join('\n')
  assert.deepEqual(homePathsIn(text), [])
})

test('only paths found in the home become links, and text inside links or code stays as it is', () => {
  const tree: MdNode = { type: 'root', children: [
    { type: 'paragraph', children: [{ type: 'text', value: 'Saved /opt/data/home/a.csv and /opt/data/home/missing.csv.' }] },
    { type: 'paragraph', children: [{ type: 'link', url: 'https://x.test', children: [{ type: 'text', value: '/opt/data/home/a.csv' }] }] },
    { type: 'code', value: '/opt/data/home/a.csv' },
  ] }
  linkHomeFiles(new Set(['/opt/data/home/a.csv']))()(tree)
  assert.deepEqual(tree.children?.[0].children, [
    { type: 'text', value: 'Saved ' },
    { type: 'link', url: '/opt/data/home/a.csv', children: [{ type: 'text', value: '/opt/data/home/a.csv' }] },
    { type: 'text', value: ' and /opt/data/home/missing.csv.' },
  ])
  assert.deepEqual(tree.children?.[1].children, [{ type: 'link', url: 'https://x.test', children: [{ type: 'text', value: '/opt/data/home/a.csv' }] }])
  assert.deepEqual(tree.children?.[2], { type: 'code', value: '/opt/data/home/a.csv' })
})
