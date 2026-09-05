import { describe, expect, test } from "bun:test"
import { buildRepositoryItems } from "../src/workspace/repositoryItems.js"
import { computeHeaderDerivations } from "../src/workspace/headerDerivations.js"
import {
	canonicalRepositoryList,
	launchScopeDisplayName,
	launchScopeIncludesRepository,
	parseLaunchOptions,
	parseGitHubOrganization,
	parseGitHubRepository,
	scopeDetectedRepository,
} from "../src/launchOptions.js"
import { itemQueryCacheKey, searchQualifier, type ItemListInput } from "../src/item.js"

const homeInput: ItemListInput<"pullRequest"> = {
	kind: "pullRequest",
	mode: "authored",
	repository: null,
	cursor: null,
	pageSize: 50,
}

describe("launch organization options", () => {
	test("CLI organization overrides the environment and is removed from forwarded args", () => {
		const result = parseLaunchOptions(["--org", "kitlangton", "--help"], { GHUI_ORG: "other-org" })
		expect(result).toEqual({
			ok: true,
			value: {
				options: {
					scope: { _tag: "Organization", organization: "kitlangton" },
					workspaceName: null,
					showScrollbars: null,
					systemThemeAutoReload: null,
				},
				remainingArgs: ["--help"],
			},
		})
	})

	test("empty environment scope is unscoped", () => {
		const result = parseLaunchOptions([], { GHUI_ORG: "   " })
		expect(result).toEqual({
			ok: true,
			value: {
				options: { scope: { _tag: "User" }, workspaceName: null, showScrollbars: null, systemThemeAutoReload: null },
				remainingArgs: [],
			},
		})
	})

	test("invalid organization input fails closed", () => {
		expect(parseLaunchOptions(["--org", "bad--login"], {})).toEqual({ ok: false, error: { message: expect.stringContaining("--org") } })
		expect(parseLaunchOptions([], { GHUI_ORG: "bad_login" })).toEqual({ ok: false, error: { message: expect.stringContaining("GHUI_ORG") } })
	})

	test("scrollbar override is parsed without affecting organization", () => {
		const result = parseLaunchOptions([], { GHUI_SHOW_SCROLLBARS: "true" })
		expect(result).toEqual({
			ok: true,
			value: {
				options: { scope: { _tag: "User" }, workspaceName: null, showScrollbars: true, systemThemeAutoReload: null },
				remainingArgs: [],
			},
		})
	})

	test.each([
		["true", true],
		["false", false],
		[undefined, null],
		["TRUE", null],
		["1", null],
		["", null],
	] as const)("system theme auto-reload override parses %p as %p", (value, expected) => {
		const result = parseLaunchOptions([], { GHUI_SYSTEM_THEME_AUTO_RELOAD: value })
		expect(result.ok && result.value.options.systemThemeAutoReload).toBe(expected)
	})

	test("GHUI_REPOSITORIES decodes, canonicalizes, deduplicates, and sorts", () => {
		const result = parseLaunchOptions([], { GHUI_REPOSITORIES: JSON.stringify(["Org/Repo", "other/z", "org/repo"]), GHUI_WORKSPACE_NAME: "Space" })
		expect(result).toMatchObject({
			ok: true,
			value: {
				options: {
					scope: { _tag: "Repositories", repositories: ["org/repo", "other/z"] },
					workspaceName: "Space",
				},
			},
		})
	})

	test("repeatable CLI --repo beats environment scope and --org conflict fails", () => {
		const result = parseLaunchOptions(["--repo", "Org/One", "--repo=org/two", "--help"], { GHUI_ORG: "other", GHUI_REPOSITORIES: JSON.stringify(["other/repo"]) })
		expect(result).toMatchObject({
			ok: true,
			value: { options: { scope: { _tag: "Repositories", repositories: ["org/one", "org/two"] } }, remainingArgs: ["--help"] },
		})
		expect(parseLaunchOptions(["--org", "org", "--repo", "org/repo"], {})).toEqual({ ok: false, error: { message: expect.stringContaining("cannot") } })
	})

	test("CLI scope ignores invalid overridden environment scopes", () => {
		expect(parseLaunchOptions(["--repo", "org/repo"], { GHUI_ORG: "bad_login", GHUI_REPOSITORIES: "not json" })).toMatchObject({
			ok: true,
			value: { options: { scope: { _tag: "Repositories", repositories: ["org/repo"] } } },
		})
		expect(parseLaunchOptions(["--org", "org"], { GHUI_ORG: "bad_login", GHUI_REPOSITORIES: "not json" })).toMatchObject({
			ok: true,
			value: { options: { scope: { _tag: "Organization", organization: "org" } } },
		})
	})

	test("repository environment JSON validates at the boundary", () => {
		expect(parseLaunchOptions([], { GHUI_REPOSITORIES: "[]" })).toEqual({ ok: false, error: { message: expect.stringContaining("nonempty") } })
		expect(parseLaunchOptions([], { GHUI_REPOSITORIES: "not json" })).toEqual({ ok: false, error: { message: expect.stringContaining("JSON") } })
	})
})

describe("organization query and cache scope", () => {
	test("HOME search carries the organization qualifier", () => {
		const organization = parseGitHubOrganization("kitlangton")
		expect(organization).not.toBeNull()
		expect(searchQualifier(homeInput, { _tag: "Organization", organization: organization! })).toContain("org:kitlangton")
	})

	test("explicit repository search remains unchanged", () => {
		const repositoryInput = { ...homeInput, repository: "other-org/repo" }
		const organization = parseGitHubOrganization("kitlangton")
		expect(searchQualifier(repositoryInput, { _tag: "Organization", organization: organization! })).toContain("repo:other-org/repo")
		expect(searchQualifier(repositoryInput, { _tag: "Organization", organization: organization! })).not.toContain("org:kitlangton")
	})

	test("scoped cache keys differ from unscoped keys", () => {
		const query = { mode: "authored" as const, repository: null, textFilter: "" }
		expect(itemQueryCacheKey("pullRequest", query)).not.toBe(
			itemQueryCacheKey("pullRequest", query, { _tag: "Organization", organization: parseGitHubOrganization("kitlangton")! }),
		)
	})

	test("repository membership is case-insensitive and owner-bound", () => {
		const organization = parseGitHubOrganization("KitLangton")
		const scope = { _tag: "Organization" as const, organization: organization! }
		expect(launchScopeIncludesRepository(scope, "kitlangton/ghui")).toBe(true)
		expect(launchScopeIncludesRepository(scope, "kitlangton-labs/ghui")).toBe(false)
	})
	test("HOME repository catalog excludes repositories outside the organization", () => {
		const organization = parseGitHubOrganization("kitlangton")
		const repositories = buildRepositoryItems({
			recentRepositories: ["kitlangton/ghui", "other-org/repo"],
			favoriteRepositories: { "other-org/repo": true },
			detectedRepository: null,
			repoRollup: [],
			pullRequests: [],
			scope: { _tag: "Organization", organization: organization! },
			allIssues: [],
			mockRepositoryCatalog: [
				{ repository: "kitlangton/ghui", description: "ghui" },
				{ repository: "other-org/repo", description: "other" },
			],
		})
		expect(repositories.map((repository) => repository.repository)).toEqual(["kitlangton/ghui"])
	})

	test("cwd repositories outside the organization resolve to HOME", () => {
		const organization = parseGitHubOrganization("kitlangton")
		expect(scopeDetectedRepository("other-org/repo", { _tag: "Organization", organization: organization! })).toBeNull()
		expect(scopeDetectedRepository("kitlangton/ghui", { _tag: "Organization", organization: organization! })).toBe("kitlangton/ghui")
	})

	test("explicit repository scope includes only canonical identities and does not auto-narrow by cwd", () => {
		const repositories = canonicalRepositoryList(["Other/Repo", "org/One", "org/one"])
		expect(repositories).toEqual(["org/one", "other/repo"])
		expect(parseGitHubRepository("Org/One.git")).toBe("org/one")
		if (repositories === null) throw new Error("expected canonical repositories")
		const scope = { _tag: "Repositories" as const, repositories }
		expect(launchScopeIncludesRepository(scope, "ORG/ONE")).toBe(true)
		expect(launchScopeIncludesRepository(scope, "org/two")).toBe(false)
		expect(scopeDetectedRepository("org/one", scope)).toBeNull()
		expect(launchScopeDisplayName(scope, "Space")).toBe("Space")
	})

	test("repository catalog seeds all explicit repositories and excludes unrelated live data", () => {
		const repositories = buildRepositoryItems({
			recentRepositories: [],
			favoriteRepositories: {},
			detectedRepository: null,
			repoRollup: [{ repository: "unrelated/repo", pullRequestCount: 2, issueCount: 0, lastActivityAt: new Date() }],
			pullRequests: [],
			scope: { _tag: "Repositories", repositories: canonicalRepositoryList(["org/one", "other/repo"])! },
			allIssues: [],
			mockRepositoryCatalog: [],
		})
		expect(repositories.map((repository) => repository.repository)).toEqual(["org/one", "other/repo"])
	})
	test("header visibly identifies the active organization", () => {
		const organization = parseGitHubOrganization("kitlangton")
		if (organization === null) throw new Error("expected valid organization")
		const header = computeHeaderDerivations({
			username: "viewer",
			notice: null,
			headerFooterWidth: 80,
			selectedRepository: null,
			scope: { _tag: "Organization", organization },
			workspaceName: null,
		})
		expect(header.homeCrumb).toContain("kitlangton")
	})
})
