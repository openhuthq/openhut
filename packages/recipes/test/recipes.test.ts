import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPE_IDS, RECIPES } from '../src/recipes.ts'

test('every recipe is listed once, with a heading named after it', () => {
  assert.deepEqual([...RECIPE_IDS].sort(), Object.keys(RECIPES).sort())
  for (const id of RECIPE_IDS) {
    const recipe = RECIPES[id]
    assert.ok(recipe.instructions.startsWith(`# ${recipe.name}\n`), id)
    assert.ok(recipe.instructions.length < 20_000, id)
    assert.ok(recipe.pitch.endsWith('.'), id)
  }
})

test('every recipe keeps its agent read-only', () => {
  for (const id of RECIPE_IDS) assert.match(RECIPES[id].instructions, /[Nn]ever (change|fix)/, id)
})
