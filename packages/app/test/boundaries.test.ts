import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const SRC = new URL('../src/', import.meta.url)

function zoneOf(file: string) {
  const [top, feature] = file.split('/')
  if (top === 'features') return `features/${feature}`
  if (top === 'app' || top === 'main.tsx') return 'app'
  return 'shared'
}

function importsOf(file: string) {
  const source = readFileSync(new URL(file, SRC), 'utf8')
  return [...source.matchAll(/(?:from\s+|import\(\s*)'([^']+)'/g)].map((match) => match[1]).flatMap((spec) => {
    if (spec.startsWith('@/')) return [spec.slice(2)]
    if (spec.startsWith('.')) return [normalize(join(dirname(file), spec))]
    return []
  })
}

function crossings() {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file))
  return files.flatMap((file) => {
    const zone = zoneOf(file)
    return importsOf(file).filter((target) => {
      const to = zoneOf(target)
      if (zone === 'shared') return to !== 'shared'
      if (zone.startsWith('features/')) return to === 'app' || (to.startsWith('features/') && to !== zone)
      return false
    }).map((target) => `${file} -> ${target.replace(/\.tsx?$/, '')}`)
  }).sort()
}

test('shared code imports no feature or app, and a feature imports no app or other feature', () => {
  assert.deepEqual(crossings(), [])
})
