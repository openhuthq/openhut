import * as z from 'zod/mini'

const Login = z.string().check(z.regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'Write the name as it appears in its GitHub URL.'))
const OwnerType = z.enum(['User', 'Organization'])

export const GithubAppInfo = z.object({
  object: z.literal('github_app'),
  app: z.nullable(z.object({
    name: z.string(),
    slug: z.string(),
    owner: z.string(),
    ownerType: OwnerType,
    ownerAvatar: z.string(),
    settingsUrl: z.string(),
    installUrl: z.string(),
    logo: z.boolean(),
    repositories: z.nullable(z.number()),
  })),
  asked: z.boolean(),
  askedBy: z.array(z.string()),
})
export type GithubAppInfo = z.infer<typeof GithubAppInfo>

export const GithubAccount = z.object({ object: z.literal('github_account'), login: z.string(), name: z.string(), type: OwnerType, avatarUrl: z.string(), appName: z.string() })
export type GithubAccount = z.infer<typeof GithubAccount>

export const ListGithubAccounts = z.object({ login: Login })

export const CreateGithubApp = z.object({
  owner: Login,
  ownerType: OwnerType,
  name: z.string().check(z.minLength(1), z.maxLength(34), z.regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, 'Use letters, digits, spaces, dots, dashes or underscores.')),
})
export type CreateGithubApp = z.infer<typeof CreateGithubApp>

export const GithubAppLaunch = z.object({ object: z.literal('github_app_launch'), url: z.string() })

export const UpdateGithubApp = z.object({ logo: z.boolean() })

export const GithubInstallation = z.object({
  object: z.literal('github_installation'),
  installationId: z.number(),
  account: z.object({ login: z.string(), type: OwnerType, avatarUrl: z.string() }),
  repositories: z.array(z.string()),
  total: z.number(),
})
export type GithubInstallation = z.infer<typeof GithubInstallation>

export const CreateGithubConnection = z.object({
  installationId: z.number(),
  repositories: z.array(z.string().check(z.regex(/^[A-Za-z0-9._-]{1,100}$/))).check(z.minLength(1), z.maxLength(100)),
})
export type CreateGithubConnection = z.infer<typeof CreateGithubConnection>
