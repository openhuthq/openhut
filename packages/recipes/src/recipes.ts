import { dev } from './dev/recipe.ts'
import { ops } from './ops/recipe.ts'
import { sales } from './sales/recipe.ts'
import { support } from './support/recipe.ts'

export const RECIPES = { dev, support, sales, ops }

export const RECIPE_IDS = ['dev', 'support', 'sales', 'ops'] as const satisfies readonly RecipeId[]

export type RecipeId = keyof typeof RECIPES
export type Recipe = {
  name: string
  pitch: string
  instructions: string
  model: 'opus' | 'sonnet' | 'haiku'
  connections: 'postgres'[]
  channels: ('slack' | 'whatsapp')[]
}
