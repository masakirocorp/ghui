const ORGANIZATION_PATTERN = /^[A-Za-z0-9-]{1,39}$/
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

export type GitHubOrganization = string & { readonly __brand: "GitHubOrganization" }
export type GitHubRepository = string & { readonly __brand: "GitHubRepository" }
export type GitHubRepositoryList = readonly [GitHubRepository, ...GitHubRepository[]]

export type LaunchScope =
	| { readonly _tag: "User" }
	| { readonly _tag: "Organization"; readonly organization: GitHubOrganization }
	| { readonly _tag: "Repositories"; readonly repositories: GitHubRepositoryList }

export interface LaunchOptions {
	readonly scope: LaunchScope
	readonly workspaceName: string | null
	readonly showScrollbars: boolean | null
	readonly systemThemeAutoReload: boolean | null
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

export const parseGitHubRepository = (value: string): GitHubRepository | null => {
	if (value.length !== value.trim().length) return null
	const separator = value.indexOf("/")
	if (separator <= 0 || separator !== value.lastIndexOf("/") || separator === value.length - 1) return null
	const owner = value.slice(0, separator)
	const rawName = value.slice(separator + 1)
	const name = rawName.replace(/\.git$/i, "")
	if (name === "." || name === "..") return null
	if (!isOrganizationLogin(owner) || !REPOSITORY_NAME_PATTERN.test(name)) return null
	return `${owner.toLowerCase()}/${name.toLowerCase()}` as GitHubRepository
}

export const canonicalRepositoryList = (values: readonly string[]): GitHubRepositoryList | null => {
	const canonical: GitHubRepository[] = []
	for (const value of values) {
		const repository = parseGitHubRepository(value)
		if (repository === null) return null
		canonical.push(repository)
	}
	const unique = [...new Set(canonical)].sort((left, right) => left.localeCompare(right))
	const [first, ...rest] = unique
	if (first === undefined) return null
	const result: [GitHubRepository, ...GitHubRepository[]] = [first, ...rest]
	return result
}

export const launchScopeRepositories = (scope: LaunchScope): readonly GitHubRepository[] => (scope._tag === "Repositories" ? scope.repositories : [])

export const launchScopeOrganization = (scope: LaunchScope): GitHubOrganization | null => (scope._tag === "Organization" ? scope.organization : null)

export const launchScopeIncludesRepository = (scope: LaunchScope, repository: string): boolean => {
	const canonical = parseGitHubRepository(repository)
	if (canonical === null) return false
	switch (scope._tag) {
		case "User":
			return true
		case "Organization":
			return canonical.slice(0, canonical.indexOf("/")) === scope.organization.toLowerCase()
		case "Repositories":
			return scope.repositories.includes(canonical)
	}
}

export const launchScopeDisplayName = (scope: LaunchScope, workspaceName: string | null = null): string => {
	const explicitName = workspaceName?.trim()
	let scopeName: string
	switch (scope._tag) {
		case "User":
			scopeName = explicitName ? "Personal" : "HOME"
			break
		case "Organization":
			scopeName = `ORG ${scope.organization}`
			break
		case "Repositories":
			scopeName = scope.repositories.join(", ")
			break
	}
	return explicitName ? `${scopeName} · ${explicitName}` : scopeName
}

export const launchScopeCacheKey = (scope: LaunchScope): string => {
	switch (scope._tag) {
		case "User":
			return "user"
		case "Organization":
			return `org:${scope.organization.toLowerCase()}`
		case "Repositories":
			return `repos:${scope.repositories.join(",")}`
	}
}

export const scopeDetectedRepository = (repository: string | null, scope: LaunchScope): string | null => {
	if (repository === null || scope._tag === "Repositories") return null
	const canonical = parseGitHubRepository(repository)
	return canonical !== null && launchScopeIncludesRepository(scope, canonical) ? canonical : null
}

const organizationError = (source: "--org" | "GHUI_ORG", value: string) =>
	`${source} must be a GitHub organization login (1-39 ASCII letters, digits, or single hyphens): ${JSON.stringify(value)}`

const repositoryError = (source: "--repo" | "GHUI_REPOSITORIES", value: string) =>
	`${source} must contain owner/repository values using a GitHub owner login and ASCII repository-name characters: ${JSON.stringify(value)}`
const parseEnvironmentRepositories = (value: string | undefined): GitHubRepositoryList | null | LaunchOptionsError => {
	const raw = value?.trim() ?? ""
	if (raw === "") return null
	let decoded: unknown
	try {
		decoded = JSON.parse(raw)
	} catch {
		return { message: `GHUI_REPOSITORIES must be a JSON array of owner/repository values: ${JSON.stringify(raw)}` }
	}
	if (!Array.isArray(decoded) || decoded.length === 0 || !decoded.every((entry): entry is string => typeof entry === "string")) {
		return { message: "GHUI_REPOSITORIES must decode to a nonempty JSON array of owner/repository values" }
	}
	const invalid = decoded.find((entry) => parseGitHubRepository(entry) === null)
	if (invalid !== undefined) return { message: repositoryError("GHUI_REPOSITORIES", invalid) }
	const repositories = canonicalRepositoryList(decoded)
	return repositories ?? { message: "GHUI_REPOSITORIES must decode to a nonempty JSON array of owner/repository values" }
}

const parseBooleanOverride = (value: string | undefined): boolean | null => {
	if (value === undefined) return null
	if (value === "true") return true
	if (value === "false") return false
	return null
}

export const parseLaunchOptions = (args: readonly string[], env: Readonly<Record<string, string | undefined>>): LaunchOptionsResult => {
	const remainingArgs: string[] = []
	let cliOrganization: GitHubOrganization | null = null
	let cliOrganizationProvided = false
	const cliRepositories: string[] = []

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index]
		if (argument === undefined) continue
		if (argument === "--org" || argument.startsWith("--org=")) {
			if (cliOrganizationProvided) return { ok: false, error: { message: "--org may only be provided once" } }
			cliOrganizationProvided = true
			const value = argument === "--org" ? args[index + 1] : argument.slice("--org=".length)
			if (value === undefined || value.startsWith("-")) return { ok: false, error: { message: "--org requires an organization login" } }
			const organization = parseGitHubOrganization(value)
			if (organization === null) return { ok: false, error: { message: organizationError("--org", value) } }
			cliOrganization = organization
			if (argument === "--org") index += 1
			continue
		}
		if (argument === "--repo" || argument.startsWith("--repo=")) {
			const value = argument === "--repo" ? args[index + 1] : argument.slice("--repo=".length)
			if (value === undefined || value.startsWith("-")) return { ok: false, error: { message: "--repo requires an owner/repository value" } }
			if (parseGitHubRepository(value) === null) return { ok: false, error: { message: repositoryError("--repo", value) } }
			cliRepositories.push(value)
			if (argument === "--repo") index += 1
			continue
		}
		remainingArgs.push(argument)
	}

	if (cliOrganizationProvided && cliRepositories.length > 0) {
		return { ok: false, error: { message: "--org and --repo cannot be combined" } }
	}

	let scope: LaunchScope
	if (cliRepositories.length > 0) {
		const repositories = canonicalRepositoryList(cliRepositories)
		if (repositories === null) return { ok: false, error: { message: "at least one --repo value is required" } }
		scope = { _tag: "Repositories", repositories }
	} else if (cliOrganization !== null) {
		scope = { _tag: "Organization", organization: cliOrganization }
	} else {
		const parsedEnvironmentRepositories = parseEnvironmentRepositories(env.GHUI_REPOSITORIES)
		if (parsedEnvironmentRepositories !== null && "message" in parsedEnvironmentRepositories) return { ok: false, error: parsedEnvironmentRepositories }
		if (parsedEnvironmentRepositories !== null) {
			scope = { _tag: "Repositories", repositories: parsedEnvironmentRepositories }
		} else {
			const environmentOrganization = env.GHUI_ORG?.trim() ?? ""
			const parsedEnvironmentOrganization = environmentOrganization === "" ? null : parseGitHubOrganization(environmentOrganization)
			if (environmentOrganization !== "" && parsedEnvironmentOrganization === null) {
				return { ok: false, error: { message: organizationError("GHUI_ORG", environmentOrganization) } }
			}
			scope = parsedEnvironmentOrganization === null ? { _tag: "User" } : { _tag: "Organization", organization: parsedEnvironmentOrganization }
		}
	}

	return {
		ok: true,
		value: {
			options: {
				scope,
				workspaceName: env.GHUI_WORKSPACE_NAME?.trim() || null,
				showScrollbars: parseBooleanOverride(env.GHUI_SHOW_SCROLLBARS),
				systemThemeAutoReload: parseBooleanOverride(env.GHUI_SYSTEM_THEME_AUTO_RELOAD),
			},
			remainingArgs,
		},
	}
}

let cachedLaunchOptions: LaunchOptions | null = null

export const getLaunchOptions = (): LaunchOptions => {
	if (cachedLaunchOptions !== null) return cachedLaunchOptions
	const result = parseLaunchOptions(process.argv.slice(2), process.env)
	if (!result.ok) throw new Error(result.error.message)
	cachedLaunchOptions = result.value.options
	return cachedLaunchOptions
}
