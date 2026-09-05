import type { IssueItem, PullRequestItem } from "../domain.js"
import { launchScopeIncludesRepository, launchScopeRepositories, type LaunchScope, parseGitHubRepository } from "../launchOptions.js"
import type { RepoRollupRow } from "../services/CacheService.js"
import type { RepositoryListItem } from "../ui/RepoList.js"

export interface CatalogEntry {
	readonly repository: string
	readonly description: string | null
}

export interface BuildRepositoryItemsInput {
	readonly recentRepositories: readonly string[]
	readonly favoriteRepositories: Readonly<Record<string, boolean>>
	readonly detectedRepository: string | null
	readonly repoRollup: readonly RepoRollupRow[]
	readonly pullRequests: readonly PullRequestItem[]
	readonly scope: LaunchScope
	readonly allIssues: readonly IssueItem[]
	readonly mockRepositoryCatalog: readonly CatalogEntry[]
}

/**
 * Build the repos-tab list:
 *   1. Seed from user state (recents, favorites, cwd) and the cached rollup so
 *      counts and last-activity dates render before live PR/issue arrays load.
 *   2. Aggregate from live PR + issue arrays, overriding seeded counts for
 *      repositories with fresh data. Repos with rollup-only data keep cache.
 *   3. Sort: current > favorite > recent > most-recent activity > name.
 */
export const buildRepositoryItems = ({
	recentRepositories,
	favoriteRepositories,
	detectedRepository,
	repoRollup,
	pullRequests,
	scope,
	allIssues,
	mockRepositoryCatalog,
}: BuildRepositoryItemsInput): readonly RepositoryListItem[] => {
	const activeScope = scope
	const byRepository = new Map<string, RepositoryListItem>()
	const catalog = new Map<string, CatalogEntry>()
	for (const item of mockRepositoryCatalog) {
		const repository = parseGitHubRepository(item.repository)
		if (repository !== null && launchScopeIncludesRepository(activeScope, repository)) catalog.set(repository, item)
	}
	const ensure = (repository: string): RepositoryListItem => {
		const canonical = parseGitHubRepository(repository) ?? repository
		const existing = byRepository.get(canonical)
		if (existing) return existing
		const catalogItem = catalog.get(canonical)
		const item: RepositoryListItem = {
			repository: canonical,
			pullRequestCount: 0,
			issueCount: 0,
			current: canonical === detectedRepository,
			favorite: favoriteRepositories[canonical] === true || favoriteRepositories[repository] === true,
			recent: recentRepositories.some((recent) => (parseGitHubRepository(recent) ?? recent) === canonical),
			lastActivityAt: null,
			description: catalogItem?.description ?? null,
		}
		byRepository.set(canonical, item)
		return item
	}
	for (const repository of launchScopeRepositories(activeScope)) ensure(repository)
	for (const repository of [...recentRepositories, ...Object.keys(favoriteRepositories), ...(detectedRepository ? [detectedRepository] : [])]) {
		if (launchScopeIncludesRepository(activeScope, repository)) ensure(repository)
	}
	for (const row of repoRollup) {
		if (!launchScopeIncludesRepository(activeScope, row.repository)) continue
		const item = ensure(row.repository)
		byRepository.set(item.repository, {
			...item,
			pullRequestCount: row.pullRequestCount,
			issueCount: row.issueCount,
			lastActivityAt: row.lastActivityAt,
		})
	}
	const liveCounts = new Map<string, { pullRequestCount: number; issueCount: number; lastActivityAt: Date | null }>()
	const bumpLive = (repository: string, at: Date, key: "pullRequestCount" | "issueCount") => {
		if (!launchScopeIncludesRepository(activeScope, repository)) return
		const canonical = parseGitHubRepository(repository) ?? repository
		const entry = liveCounts.get(canonical) ?? { pullRequestCount: 0, issueCount: 0, lastActivityAt: null }
		entry[key] = entry[key] + 1
		if (!entry.lastActivityAt || entry.lastActivityAt < at) entry.lastActivityAt = at
		liveCounts.set(canonical, entry)
	}
	for (const pullRequest of pullRequests) bumpLive(pullRequest.repository, pullRequest.updatedAt, "pullRequestCount")
	for (const issue of allIssues) bumpLive(issue.repository, issue.updatedAt, "issueCount")
	for (const [repository, entry] of liveCounts) {
		const current = ensure(repository)
		const lastActivityAt = entry.lastActivityAt && (!current.lastActivityAt || current.lastActivityAt < entry.lastActivityAt) ? entry.lastActivityAt : current.lastActivityAt
		byRepository.set(repository, {
			...current,
			pullRequestCount: entry.pullRequestCount,
			issueCount: entry.issueCount,
			lastActivityAt,
		})
	}
	return [...byRepository.values()].sort((left, right) => {
		if (left.current !== right.current) return left.current ? -1 : 1
		if (left.favorite !== right.favorite) return left.favorite ? -1 : 1
		if (left.recent !== right.recent) return left.recent ? -1 : 1
		const leftTime = left.lastActivityAt?.getTime() ?? 0
		const rightTime = right.lastActivityAt?.getTime() ?? 0
		return rightTime - leftTime || left.repository.localeCompare(right.repository)
	})
}
