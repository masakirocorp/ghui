import { Cause, Effect } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { IssueItem, PullRequestItem } from "../../domain.js"
import { config } from "../../config.js"
import { errorMessage } from "../../errors.js"
import { getLaunchOptions, launchScopeRepositories } from "../../launchOptions.js"
import { GitHubService } from "../../services/GitHubService.js"
import { githubRuntime } from "../../services/runtime.js"
import { selectedRepositoryAtom, workspaceSurfaceAtom } from "../../workspace/atoms.js"

export interface OverviewData {
	readonly authoredPullRequests: readonly PullRequestItem[]
	readonly requestedReviewPullRequests: readonly PullRequestItem[]
	readonly assignedIssues: readonly IssueItem[]
}

const uniqueRepositories = (selectedRepository: string | null): readonly string[] => {
	if (selectedRepository !== null) return [selectedRepository]
	return launchScopeRepositories(getLaunchOptions().scope)
}

const listPullRequests = (repository: string | null, mode: "authored" | "review") =>
	GitHubService.use((github) => github.listAllPullRequests({ kind: "pullRequest", mode, repository }))

const listIssues = (repository: string | null) => GitHubService.use((github) => github.listAllIssues({ kind: "issue", mode: "assigned", repository }))

const byUpdated = <T extends { readonly updatedAt: Date }>(items: readonly T[]): readonly T[] => [...items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

const listAcrossScope = <T, E, R>(repositories: readonly string[], list: (repository: string | null) => Effect.Effect<readonly T[], E, R>) =>
	repositories.length === 0 ? list(null) : Effect.forEach(repositories, list, { concurrency: 8 }).pipe(Effect.map((groups) => groups.flat()))

export const overviewAtom = githubRuntime
	.atom((get) =>
		Effect.gen(function* () {
			if (get(workspaceSurfaceAtom) !== "overview") return { authoredPullRequests: [], requestedReviewPullRequests: [], assignedIssues: [] } satisfies OverviewData
			const selectedRepository = get(selectedRepositoryAtom)
			const repositories = uniqueRepositories(selectedRepository)
			const [authoredPullRequests, requestedReviewPullRequests, assignedIssues] = yield* Effect.all(
				[
					listAcrossScope(repositories, (repository) => listPullRequests(repository, "authored")),
					listAcrossScope(repositories, (repository) => listPullRequests(repository, "review")),
					listAcrossScope(repositories, (repository) => listIssues(repository)),
				],
				{ concurrency: "unbounded" },
			)
			return {
				authoredPullRequests: byUpdated(authoredPullRequests).slice(0, config.prFetchLimit),
				requestedReviewPullRequests: byUpdated(requestedReviewPullRequests).slice(0, config.prFetchLimit),
				assignedIssues: byUpdated(assignedIssues).slice(0, config.prFetchLimit),
			} satisfies OverviewData
		}),
	)
	.pipe(Atom.setIdleTTL(0))

export type OverviewLoad = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly data: OverviewData }

export const overviewLoad = (result: AsyncResult.AsyncResult<OverviewData, unknown>): OverviewLoad => {
	if (AsyncResult.isSuccess(result)) return { status: "ready", data: result.value }
	if (AsyncResult.isFailure(result)) return { status: "error", message: errorMessage(Cause.squash(result.cause)) }
	return { status: "loading" }
}
