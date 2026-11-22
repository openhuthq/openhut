export function useChannel({ updater, beta }) {
  updater.channel = beta ? 'beta' : 'latest'
  updater.allowDowngrade = false
}
