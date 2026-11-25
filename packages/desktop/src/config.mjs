import env from 'env-var'

// Every environment variable the desktop app's main process reads lives here.
if (process.platform === 'win32') process.env.NODE_PENDING_PIPE_INSTANCES ??= '64' // more named-pipe instances for the server and agents it starts

export const config = {
  appImage: env.get('APPIMAGE').asString(), // set by the AppImage runtime: this is the Linux AppImage
  testHome: env.get('OPENHUT_TEST_HOME').asString(), // e2e runs: a throwaway home, and the test switches below
  secondApp: env.get('OPENHUT_SECOND_APP').default('false').asBool(), // e2e: a second copy runs beside the first
  devCloudUrl: env.get('OPENHUT_CLOUD_URL').default('http://127.0.0.1:8790').asString(), // dev runs: the Cloud they reach
  devApiUrl: env.get('OPENHUT_API_URL').default('http://127.0.0.1:8792').asString(), // dev runs: that Cloud's API
  hermesRuntime: env.get('AGENTD_HERMES').asString(), // overrides the bundled Python and Node runtime
  gatewayPort: env.get('OPENHUT_GATEWAY_PORT').asPortNumber(), // overrides the agents' gateway port (8081, 8091 for dev)
  installUrl: env.get('OPENHUT_INSTALL_URL').asString(), // overrides the install script a computer you add runs
  model: env.get('OPENHUT_MODEL').asString(), // 'test' or 'claude'; dev runs default to 'test'
  sandbox: env.get('OPENHUT_SANDBOX').default('native').asString(), // how the server runs agents
  updateFeed: env.get('OPENHUT_UPDATE_FEED').asString(), // overrides the update feed (update tests)
  testPresence: env.get('OPENHUT_TEST_PRESENCE').asString(), // e2e: a file whose 'yes' stands in for Touch ID
  testHidden: env.get('OPENHUT_TEST_HIDDEN').default('false').asBool(), // e2e: never show the window
  testDialog: env.get('OPENHUT_TEST_DIALOG').asString(), // e2e: the button the "couldn't start" dialog picks
  releaseKey: env.get('OPENHUT_RELEASE_KEY').asString(), // e2e: the release signing key, instead of the real one
  nextKey: env.get('OPENHUT_NEXT_KEY').default('').asString(), // e2e: the next release key
  rekorKey: env.get('OPENHUT_REKOR_KEY').asString(), // e2e: the transparency log key
}
