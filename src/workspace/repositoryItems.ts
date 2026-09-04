import type { IssueItem, PullRequestItem } from "../domain.js"
import { repositoryBelongsToOrganization, type GitHubOrganization } from "../launchOptions.js"
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
	readonly organization: GitHubOrganization | null
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
	organization,
	allIssues,
	mockRepositoryCatalog,
}: BuildRepositoryItemsInput): readonly RepositoryListItem[] => {
	const byRepository = new Map<string, RepositoryListItem>()
	const catalog = new Map(mockRepositoryCatalog.filter((item) => repositoryBelongsToOrganization(item.repository, organization)).map((item) => [item.repository, item]))
	const ensure = (repository: string): RepositoryListItem => {
		const existing = byRepository.get(repository)
		if (existing) return existing
		const catalogItem = catalog.get(repository)
		const item: RepositoryListItem = {
			repository,
			pullRequestCount: 0,
			issueCount: 0,
			current: repository === detectedRepository,
			favorite: favoriteRepositories[repository] === true,
			recent: recentRepositories.includes(repository),
			lastActivityAt: null,
			description: catalogItem?.description ?? null,
		}
		byRepository.set(repository, item)
		return item
	}
	for (const repository of [...recentRepositories, ...Object.keys(favoriteRepositories), ...(detectedRepository ? [detectedRepository] : [])]) {
		if (repositoryBelongsToOrganization(repository, organization)) ensure(repository)
	}
	for (const row of repoRollup) {
		if (!repositoryBelongsToOrganization(row.repository, organization)) continue
		const item = ensure(row.repository)
		byRepository.set(row.repository, {
			...item,
			pullRequestCount: row.pullRequestCount,
			issueCount: row.issueCount,
			lastActivityAt: row.lastActivityAt,
		})
	}
	const liveCounts = new Map<string, { pullRequestCount: number; issueCount: number; lastActivityAt: Date | null }>()
	const bumpLive = (repository: string, at: Date, key: "pullRequestCount" | "issueCount") => {
		if (!repositoryBelongsToOrganization(repository, organization)) return
		const entry = liveCounts.get(repository) ?? { pullRequestCount: 0, issueCount: 0, lastActivityAt: null }
		entry[key] = entry[key] + 1
		if (!entry.lastActivityAt || entry.lastActivityAt < at) entry.lastActivityAt = at
		liveCounts.set(repository, entry)
	}
	for (const pullRequest of pullRequests) {
		bumpLive(pullRequest.repository, pullRequest.updatedAt, "pullRequestCount")
	}
	for (const issue of allIssues) {
		bumpLive(issue.repository, issue.updatedAt, "issueCount")
	}
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
