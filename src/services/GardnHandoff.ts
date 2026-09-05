import { realpath } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import type { PullRequestItem, WorkflowRun } from "../domain.js"
import { resolveRepoPath } from "../editorCommand.js"
import { parseGitRemoteUrl } from "../gitRemotes.js"
import { parseGitHubRepository } from "../launchOptions.js"
import { loadStoredEditorConfig } from "../themeStore.js"
import { CommandError, CommandRunner } from "./CommandRunner.js"

export interface GardnAgent {
	readonly target: string
	readonly name: string
	readonly status: string
}

export type GardnHandoffContext =
	| { readonly kind: "pullRequest"; readonly pullRequest: PullRequestItem }
	| { readonly kind: "workflowRun"; readonly repository: string; readonly run: WorkflowRun }

export const gardnHandoffAvailable = (): boolean => isAbsolute(process.env.GARDN_BIN_PATH ?? "") && isAbsolute(process.env.GARDN_SOCKET_PATH ?? "")

export const gardnContextText = (context: GardnHandoffContext): string => {
	if (context.kind === "pullRequest") {
		const pr = context.pullRequest
		return `GitHub pull request context\nRepository: ${pr.repository}\nPull request: #${pr.number}\nURL: ${pr.url}\nHead commit: ${pr.headRefOid}\nChecks: ${pr.checkStatus}\nReview: ${pr.reviewStatus}`
	}
	const { repository, run } = context
	return `GitHub Actions context\nRepository: ${repository}\nRun: ${run.id}, attempt ${run.attempt}\nURL: ${run.url}\nHead commit: ${run.headSha}\nStatus: ${run.status}\nConclusion: ${run.conclusion ?? "pending"}`
}

const handoffError = (detail: string, cause: unknown = detail) => new CommandError({ command: "gardn", args: [], detail, cause })
const failure = (cause: unknown) => handoffError(cause instanceof Error ? cause.message : String(cause), cause)
const LocationSchema = Schema.Struct({ execution_host_id: Schema.String, path: Schema.String })
const WorkspaceSchema = Schema.Struct({ workspace_id: Schema.String, default_location: LocationSchema })
const WorkspaceListSchema = Schema.Struct({ result: Schema.Struct({ type: Schema.Literal("workspace_list"), workspaces: Schema.Array(WorkspaceSchema) }) })
const WorkspaceCreatedSchema = Schema.Struct({ result: Schema.Struct({ type: Schema.Literal("workspace_created"), workspace: WorkspaceSchema }) })
const AgentListSchema = Schema.Struct({
	result: Schema.Struct({
		type: Schema.Literal("agent_list"),
		agents: Schema.Array(
			Schema.Struct({
				pane_id: Schema.String,
				name: Schema.optional(Schema.NullOr(Schema.String)),
				agent: Schema.optional(Schema.NullOr(Schema.String)),
				agent_status: Schema.String,
			}),
		),
	}),
})
const WorktreeSchema = Schema.Struct({ path: Schema.String, branch: Schema.String })
const RepositoryPathsSchema = Schema.Record(Schema.String, Schema.String)

export class GardnHandoff extends Context.Service<
	GardnHandoff,
	{
		readonly openCheckout: (repository: string) => Effect.Effect<void, CommandError>
		readonly createReviewSpace: (pullRequest: PullRequestItem) => Effect.Effect<void, CommandError>
		readonly listAgents: () => Effect.Effect<readonly GardnAgent[], CommandError>
		readonly sendContext: (target: string, context: GardnHandoffContext) => Effect.Effect<void, CommandError>
	}
>()("ghui/GardnHandoff") {
	static readonly layerNoDeps = Layer.effect(
		GardnHandoff,
		Effect.gen(function* () {
			const command = yield* CommandRunner
			const gardnBinary = () =>
				Effect.sync(() => process.env.GARDN_BIN_PATH).pipe(
					Effect.flatMap((binary) =>
						binary && gardnHandoffAvailable() ? Effect.succeed(binary) : Effect.fail(handoffError("Open ghui from Gardn to use same-session handoffs.")),
					),
				)
			const repositoryPath = Effect.fn("GardnHandoff.repositoryPath")(function* (repository: string) {
				const identity = parseGitHubRepository(repository)
				if (identity === null) return yield* handoffError(`Invalid GitHub repository: ${repository}`)
				const launchPaths = yield* Effect.try({
					try: () => Schema.decodeUnknownSync(RepositoryPathsSchema)(JSON.parse(process.env.GHUI_REPOSITORY_PATHS || "{}")),
					catch: (cause) => handoffError("Invalid GHUI_REPOSITORY_PATHS launch data.", cause),
				})
				const { repoPaths } = yield* loadStoredEditorConfig
				const launchPath = Object.entries(launchPaths).find(([repo]) => repo.toLowerCase() === identity.toLowerCase())?.[1]
				const candidate = launchPath ?? resolveRepoPath(repoPaths, repository) ?? process.cwd()
				const path = yield* Effect.tryPromise({ try: () => realpath(candidate), catch: failure })
				const remotes = yield* command.run("git", ["-C", path, "config", "--get-regexp", "^remote\\..*\\.url$"])
				const matches = remotes.stdout.split("\n").some((line) => {
					const separator = line.search(/\s/)
					return separator >= 0 && parseGitRemoteUrl(line.slice(separator + 1))?.toLowerCase() === identity.toLowerCase()
				})
				if (!matches) return yield* handoffError(`No local checkout matches ${repository}. Open its checkout in the Space or set repoPaths in ghui configuration.`)
				const root = yield* command.run("git", ["-C", path, "rev-parse", "--show-toplevel"])
				return yield* Effect.tryPromise({ try: () => realpath(root.stdout.trim()), catch: failure })
			})
			const openSpace = Effect.fn("GardnHandoff.openSpace")(function* (binary: string, path: string, label: string) {
				const response = yield* command.runSchema(WorkspaceListSchema, binary, ["workspace", "list"]).pipe(Effect.mapError(failure))
				for (const workspace of response.result.workspaces) {
					if (workspace.default_location.execution_host_id !== "local") continue
					const existingPath = yield* Effect.promise(() => realpath(workspace.default_location.path).catch(() => null))
					if (existingPath !== path) continue
					yield* command.run(binary, ["workspace", "focus", workspace.workspace_id])
					return
				}
				yield* command.runSchema(WorkspaceCreatedSchema, binary, ["workspace", "create", "--cwd", path, "--label", label, "--focus"]).pipe(Effect.mapError(failure))
			})
			const openCheckout = Effect.fn("GardnHandoff.openCheckout")(function* (repository: string) {
				const binary = yield* gardnBinary()
				const path = yield* repositoryPath(repository)
				yield* openSpace(binary, path, repository)
			})
			const createReviewSpace = Effect.fn("GardnHandoff.createReviewSpace")(function* (pr: PullRequestItem) {
				const binary = yield* gardnBinary()
				if (!Number.isSafeInteger(pr.number) || pr.number < 1 || !/^[a-f0-9]{40,64}$/i.test(pr.headRefOid)) {
					return yield* handoffError("Refresh the pull request before creating its review Space.")
				}
				const path = yield* repositoryPath(pr.repository)
				yield* command.run(binary, ["workspace", "list"])
				yield* command.run("wt", ["--version"])
				const branch = `ghui-review-${pr.repository.replace("/", "-")}-${pr.number}-${pr.headRefOid.slice(0, 12)}`
				const existing = yield* command.run("git", ["-C", path, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`])
				if (existing.stdout.trim() && existing.stdout.trim() !== pr.headRefOid) {
					return yield* handoffError(`Review branch ${branch} has changed. Keep its work and choose a different review checkout.`)
				}
				if (!existing.stdout.trim()) {
					yield* command.run("git", ["-C", path, "fetch", "--no-tags", `https://github.com/${pr.repository}.git`, `refs/pull/${pr.number}/head`])
					const fetched = yield* command.run("git", ["-C", path, "rev-parse", "FETCH_HEAD"])
					if (fetched.stdout.trim() !== pr.headRefOid) return yield* handoffError("The pull request changed. Refresh it before creating a review Space.")
				}
				const args = ["-C", path, "switch", ...(existing.stdout.trim() ? [] : ["--create", "--base", pr.headRefOid]), "--no-hooks", "--format", "json", branch]
				const worktree = yield* command.runSchema(WorktreeSchema, "wt", args).pipe(Effect.mapError(failure))
				const reviewPath = yield* Effect.tryPromise({ try: () => realpath(worktree.path), catch: failure })
				if (reviewPath === path) return yield* handoffError("Worktrunk did not create a separate review checkout. The current Space was not changed.")
				const reviewHead = yield* command.run("git", ["-C", reviewPath, "rev-parse", "HEAD"])
				if (worktree.branch !== branch || reviewHead.stdout.trim() !== pr.headRefOid) {
					return yield* handoffError(`Review checkout ${reviewPath} no longer matches this pull request snapshot. Its work was preserved.`)
				}
				const reviewStatus = yield* command.run("git", ["-C", reviewPath, "status", "--porcelain", "--untracked-files=normal"])
				if (reviewStatus.stdout.trim()) {
					return yield* handoffError(
						`Review checkout ${reviewPath} has uncommitted changes. Commit or move that work before reopening the pull request snapshot. Its work was preserved.`,
					)
				}
				yield* openSpace(binary, reviewPath, `${pr.repository}#${pr.number}`).pipe(
					Effect.mapError((cause) => handoffError(`Review checkout is ready at ${reviewPath}, but Gardn could not open it: ${cause.detail}`, cause)),
				)
			})
			const listAgents = Effect.fn("GardnHandoff.listAgents")(function* () {
				const binary = yield* gardnBinary()
				const response = yield* command.runSchema(AgentListSchema, binary, ["agent", "list"]).pipe(Effect.mapError(failure))
				return response.result.agents.flatMap((agent): GardnAgent[] => {
					const name = agent.name ?? agent.agent
					return name ? [{ target: agent.pane_id, name, status: agent.agent_status }] : []
				})
			})
			const sendContext = Effect.fn("GardnHandoff.sendContext")(function* (target: string, context: GardnHandoffContext) {
				const binary = yield* gardnBinary()
				const agents = yield* listAgents()
				if (!agents.some((agent) => agent.target === target)) return yield* handoffError("That agent is no longer available. Choose an active agent.")
				yield* command.run(binary, ["agent", "prompt", target, gardnContextText(context)])
			})
			return GardnHandoff.of({ openCheckout, createReviewSpace, listAgents, sendContext })
		}),
	)
}
