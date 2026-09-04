const ORGANIZATION_PATTERN = /^[A-Za-z0-9-]{1,39}$/

export type GitHubOrganization = string & { readonly __brand: "GitHubOrganization" }

export interface LaunchOptions {
	readonly organization: GitHubOrganization | null
	readonly showScrollbars: boolean | null
}

export interface ParsedLaunchOptions {
	readonly options: LaunchOptions
	readonly remainingArgs: readonly string[]
}

export interface LaunchOptionsError {
	readonly message: string
}

export type LaunchOptionsResult = { readonly ok: true; readonly value: ParsedLaunchOptions } | { readonly ok: false; readonly error: LaunchOptionsError }

const isOrganizationLogin = (value: string): boolean => {
	if (value.length !== value.trim().length || !ORGANIZATION_PATTERN.test(value)) return false
	if (value.startsWith("-") || value.endsWith("-") || value.includes("--")) return false
	return true
}

export const parseGitHubOrganization = (value: string): GitHubOrganization | null => {
	if (!isOrganizationLogin(value)) return null
	return value as GitHubOrganization
}
export const scopeDetectedRepository = (repository: string | null, organization: GitHubOrganization | null): string | null =>
	repository !== null && repositoryBelongsToOrganization(repository, organization) ? repository : null
const organizationError = (source: "--org" | "GHUI_ORG", value: string) =>
	`${source} must be a GitHub organization login (1-39 ASCII letters, digits, or single hyphens): ${JSON.stringify(value)}`
const parseBooleanOverride = (value: string | undefined): boolean | null => {
	if (value === undefined) return null
	if (value === "true") return true
	if (value === "false") return false
	return null
}

export const parseLaunchOptions = (args: readonly string[], env: Readonly<Record<string, string | undefined>>): LaunchOptionsResult => {
	const environmentOrganization = env.GHUI_ORG?.trim() ?? ""
	const parsedEnvironmentOrganization = environmentOrganization === "" ? null : parseGitHubOrganization(environmentOrganization)
	if (environmentOrganization !== "" && parsedEnvironmentOrganization === null) {
		return { ok: false, error: { message: organizationError("GHUI_ORG", environmentOrganization) } }
	}

	const remainingArgs: string[] = []
	let cliOrganization: GitHubOrganization | null = null
	let cliOrganizationProvided = false

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index]
		if (argument === undefined) continue
		if (argument === "--org") {
			if (cliOrganizationProvided) return { ok: false, error: { message: "--org may only be provided once" } }
			cliOrganizationProvided = true
			const value = args[index + 1]
			if (value === undefined || value.startsWith("-")) return { ok: false, error: { message: "--org requires an organization login" } }
			const organization = parseGitHubOrganization(value)
			if (organization === null) return { ok: false, error: { message: organizationError("--org", value) } }
			cliOrganization = organization
			index += 1
			continue
		}
		if (argument.startsWith("--org=")) {
			if (cliOrganizationProvided) return { ok: false, error: { message: "--org may only be provided once" } }
			cliOrganizationProvided = true
			const value = argument.slice("--org=".length)
			const organization = parseGitHubOrganization(value)
			if (organization === null) return { ok: false, error: { message: organizationError("--org", value) } }
			cliOrganization = organization
			continue
		}
		remainingArgs.push(argument)
	}

	return {
		ok: true,
		value: {
			options: {
				organization: cliOrganization ?? parsedEnvironmentOrganization,
				showScrollbars: parseBooleanOverride(env.GHUI_SHOW_SCROLLBARS),
			},
			remainingArgs,
		},
	}
}
let cachedLaunchOptions: LaunchOptions | null = null

export const getLaunchOptions = (): LaunchOptions => {
	if (cachedLaunchOptions !== null) return cachedLaunchOptions
	const result = parseLaunchOptions(Bun.argv.slice(2), process.env)
	if (!result.ok) throw new Error(result.error.message)
	cachedLaunchOptions = result.value.options
	return cachedLaunchOptions
}
export const repositoryBelongsToOrganization = (repository: string, organization: GitHubOrganization | null): boolean => {
	if (organization === null) return true
	const separator = repository.indexOf("/")
	if (separator <= 0 || separator === repository.length - 1) return false
	const owner = repository.slice(0, separator)
	return owner.toLowerCase() === organization.toLowerCase()
}
