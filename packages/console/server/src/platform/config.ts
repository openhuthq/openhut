import env from 'env-var'

export const config = {
  dataDir: env.get('CONSOLE_DATA').default('.console-data').asString(),
  port: env.get('PORT').default('8790').asPortNumber(),
  publishKey: env.get('CONSOLE_PUBLISH_KEY').default('').asString(),
  webDist: new URL('../../../dist/', import.meta.url),
}
