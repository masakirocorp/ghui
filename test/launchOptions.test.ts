import { describe, expect, test } from "bun:test"
import { buildRepositoryItems } from "../src/workspace/repositoryItems.js"
import { computeHeaderDerivations } from "../src/workspace/headerDerivations.js"
import { parseLaunchOptions, parseGitHubOrganization, repositoryBelongsToOrganization, scopeDetectedRepository } from "../src/launchOptions.js"
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
				options: { organization: "kitlangton", showScrollbars: null, systemThemeAutoReload: null },
				remainingArgs: ["--help"],
			},
		})
	})

	test("empty environment scope is unscoped", () => {
		const result = parseLaunchOptions([], { GHUI_ORG: "   " })
		expect(result).toEqual({
			ok: true,
			value: { options: { organization: null, showScrollbars: null, systemThemeAutoReload: null }, remainingArgs: [] },
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
			value: { options: { organization: null, showScrollbars: true, systemThemeAutoReload: null }, remainingArgs: [] },
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
})

describe("organization query and cache scope", () => {
	test("HOME search carries the organization qualifier", () => {
		const organization = parseGitHubOrganization("kitlangton")
		expect(organization).not.toBeNull()
		expect(searchQualifier(homeInput, organization)).toContain("org:kitlangton")
	})

	test("explicit repository search remains unchanged", () => {
		const repositoryInput = { ...homeInput, repository: "other-org/repo" }
		const organization = parseGitHubOrganization("kitlangton")
		expect(searchQualifier(repositoryInput, organization)).toContain("repo:other-org/repo")
		expect(searchQualifier(repositoryInput, organization)).not.toContain("org:kitlangton")
	})

	test("scoped cache keys differ from unscoped keys", () => {
		const query = { mode: "authored" as const, repository: null, textFilter: "" }
		expect(itemQueryCacheKey("pullRequest", query)).not.toBe(itemQueryCacheKey("pullRequest", query, parseGitHubOrganization("kitlangton")))
	})

	test("repository membership is case-insensitive and owner-bound", () => {
		const organization = parseGitHubOrganization("KitLangton")
		expect(repositoryBelongsToOrganization("kitlangton/ghui", organization)).toBe(true)
		expect(repositoryBelongsToOrganization("kitlangton-labs/ghui", organization)).toBe(false)
	})
	test("HOME repository catalog excludes repositories outside the organization", () => {
		const organization = parseGitHubOrganization("kitlangton")
		const repositories = buildRepositoryItems({
			recentRepositories: ["kitlangton/ghui", "other-org/repo"],
			favoriteRepositories: { "other-org/repo": true },
			detectedRepository: null,
			repoRollup: [],
			pullRequests: [],
			organization,
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
		expect(scopeDetectedRepository("other-org/repo", organization)).toBeNull()
		expect(scopeDetectedRepository("kitlangton/ghui", organization)).toBe("kitlangton/ghui")
	})

	test("header visibly identifies the active organization", () => {
		const organization = parseGitHubOrganization("kitlangton")
		const header = computeHeaderDerivations({
			username: "viewer",
			notice: null,
			headerFooterWidth: 80,
			selectedRepository: null,
			organization,
		})
		expect(header.homeCrumb).toContain("kitlangton")
	})
})
