import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileSpecStream } from '@json-render/core'
import { CARD_PROMPT, parseCard, SPEC_BLOCK } from '../../src/cards/card.ts'

test('the example card in the prompt is a valid card', () => {
  assert.ok(parseCard(compileSpecStream(SPEC_BLOCK.exec(CARD_PROMPT)?.[1] ?? '')))
})

test('parseCard refuses unknown components, bad props, missing children and a root that isn\'t a Card', () => {
  assert.equal(parseCard({ root: 'c', elements: { c: { type: 'Slider', props: {} } } }), undefined)
  assert.equal(parseCard({ root: 'c', elements: { c: { type: 'Card', props: {} } } }), undefined)
  assert.equal(parseCard({ root: 'c', elements: { c: { type: 'Card', props: { title: 'x' }, children: ['gone'] } } }), undefined)
  assert.equal(parseCard({ root: 't', elements: { t: { type: 'Text', props: { content: 'x' } } } }), undefined)
})

test('the prompt stays short', () => {
  assert.ok(CARD_PROMPT.length < 2500, `${CARD_PROMPT.length} characters`)
})
