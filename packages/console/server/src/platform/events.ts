import { initLogger, log } from 'evlog'

initLogger({ env: { service: 'jakebox-console' }, pretty: process.stdout.isTTY === true, redact: true })

export { log }
