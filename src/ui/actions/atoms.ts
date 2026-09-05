import { Cause, Effect } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { WorkflowRun } from "../../domain.js"
import { errorMessage } from "../../errors.js"
import { GitHubService } from "../../services/GitHubService.js"
import { githubRuntime } from "../../services/runtime.js"
import { selectedRepositoryAtom, workspaceSurfaceAtom } from "../../workspace/atoms.js"

export interface ActionRun {
	readonly repository: string
	readonly run: WorkflowRun
}

export interface ActionRepositoryResult {
	readonly repository: string
	readonly runs: readonly WorkflowRun[]
	readonly error: string | null
}

export interface ActionsData {
	readonly runs: readonly ActionRun[]
	readonly errors: readonly ActionRepositoryResult[]
}

export type ActionsFilter = "all" | "failed" | "running"
export const actionsFilterAtom = Atom.make<ActionsFilter>("all").pipe(Atom.keepAlive)
export const selectedActionRunAtom = Atom.make<ActionRun | null>(null).pipe(Atom.keepAlive)

export const actionsAtom = githubRuntime
	.atom((get) =>
		Effect.gen(function* () {
			if (get(workspaceSurfaceAtom) !== "actions") return { runs: [], errors: [] } satisfies ActionsData
			const selectedRepository = get(selectedRepositoryAtom)
			const repositories = selectedRepository === null ? yield* GitHubService.use((github) => github.listScopedRepositories()) : [selectedRepository]
			const results = yield* Effect.forEach(
				repositories,
				(repository) =>
					GitHubService.use((github) => github.listWorkflowRunsForRepository(repository)).pipe(
						Effect.map((runs): ActionRepositoryResult => ({ repository, runs, error: null })),
						Effect.catch((cause) => Effect.succeed({ repository, runs: [], error: errorMessage(cause) } satisfies ActionRepositoryResult)),
					),
				{ concurrency: 8 },
			)
			return {
				runs: results.flatMap((result) => result.runs.map((run) => ({ repository: result.repository, run }) satisfies ActionRun)),
				errors: results.filter((result) => result.error !== null),
			} satisfies ActionsData
		}),
	)
	.pipe(Atom.setIdleTTL(0))

const parseActionRunKey = (key: string): { readonly repository: string; readonly runId: number } | null => {
	const separator = key.lastIndexOf("\u0000")
	if (separator <= 0) return null
	const repository = key.slice(0, separator)
	const runId = Number(key.slice(separator + 1))
	return Number.isFinite(runId) ? { repository, runId } : null
}

export const actionRunDetailsFor = Atom.family((key: string) => {
	const parsed = parseActionRunKey(key)
	return githubRuntime
		.atom(
			Effect.gen(function* () {
				if (parsed === null) return null
				return yield* GitHubService.use((github) => github.getWorkflowRunDetails(parsed.repository, parsed.runId))
			}),
		)
		.pipe(Atom.setIdleTTL(0))
})

export type ActionsLoad = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly data: ActionsData }

export const actionsLoad = (result: AsyncResult.AsyncResult<ActionsData, unknown>): ActionsLoad => {
	if (AsyncResult.isSuccess(result)) return { status: "ready", data: result.value }
	if (AsyncResult.isFailure(result)) return { status: "error", message: errorMessage(Cause.squash(result.cause)) }
	return { status: "loading" }
}
