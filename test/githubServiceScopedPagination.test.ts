import { expect, test } from "bun:test"
import { runIsolatedProbe } from "./isolatedProbe.ts"

const runScopedPageProbe = async (kind: "pullRequest" | "issue") => {
	const output = await runIsolatedProbe(
		`
import { Effect, Layer, Schema } from "effect"
import { CommandRunner } from "./src/services/CommandRunner.ts"
import { GitHubService } from "./src/services/GitHubService.ts"

const item = (repository, number, updatedAt) => ({
	number,
	title: repository + " #" + number,
	state: "OPEN",
	createdAt: updatedAt,
	closedAt: null,
	url: "https://github.com/" + repository + "/pull/" + number,
	author: { login: "alice" },
	repository: { nameWithOwner: repository, defaultBranchRef: { name: "main" } },
	updatedAt,
	${kind === "pullRequest" ? 'isDraft: false, reviewDecision: null, autoMergeRequest: null, merged: false, headRefOid: "sha-" + number, headRefName: "branch-" + number, baseRefName: "main",' : 'body: "issue body", labels: { nodes: [] }, comments: { totalCount: 0 },'}
})

const pages = {
	"owner/a": {
		first: [item("owner/a", 2, "2026-04-01T00:00:00Z"), item("owner/a", 1, "2026-03-01T00:00:00Z")],
		next: [item("owner/a", 0, "2026-01-01T00:00:00Z")],
	},
	"owner/b": { first: [item("owner/b", 3, "2026-02-01T00:00:00Z")], next: [] },
}
const calls = []
const commandRunner = Layer.succeed(CommandRunner, CommandRunner.of({
	run: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
	runSchema: (schema, _command, args) => {
		if (args[0] === "api" && args[1] === "user") return Schema.decodeUnknownEffect(schema)({ login: "alice" })
		const search = args.find((arg) => arg.startsWith("searchQuery=")) ?? ""
		const repository = search.match(/repo:([^ ]+)/)?.[1] ?? ""
		const cursor = args.find((arg) => arg.startsWith("after="))?.slice("after=".length) ?? null
		calls.push({ repository, search, cursor })
		const page = cursor === null ? pages[repository].first : pages[repository].next
		const response = { data: { search: { nodes: page, pageInfo: { hasNextPage: cursor === null && repository === "owner/a", endCursor: cursor === null && repository === "owner/a" ? "next-a" : null } } } }
		return Schema.decodeUnknownEffect(schema)(response)
	},
}))
const load = GitHubService.use((github) => github.list${kind === "pullRequest" ? "PullRequest" : "Issue"}Page({ kind: "${kind}", mode: "authored", repository: null, cursor: null, pageSize: 2 }))
const first = await Effect.runPromise(load.pipe(Effect.provide(GitHubService.layerNoDeps.pipe(Layer.provide(commandRunner)))))
const second = await Effect.runPromise(GitHubService.use((github) => github.list${kind === "pullRequest" ? "PullRequest" : "Issue"}Page({ kind: "${kind}", mode: "authored", repository: null, cursor: first.endCursor, pageSize: 1 })).pipe(Effect.provide(GitHubService.layerNoDeps.pipe(Layer.provide(commandRunner)))))
const third = await Effect.runPromise(GitHubService.use((github) => github.list${kind === "pullRequest" ? "PullRequest" : "Issue"}Page({ kind: "${kind}", mode: "authored", repository: null, cursor: second.endCursor, pageSize: 3 })).pipe(Effect.provide(GitHubService.layerNoDeps.pipe(Layer.provide(commandRunner)))))
console.log(JSON.stringify({ first: first.items.map((item) => item.repository + "#" + item.number), second: second.items.map((item) => item.repository + "#" + item.number), third: third.items.map((item) => item.repository + "#" + item.number), endCursor: third.endCursor, calls }))
`,
		{ GHUI_REPOSITORIES: JSON.stringify(["owner/a", "owner/b"]) },
	)
	return JSON.parse(output) as {
		first: string[]
		second: string[]
		third: string[]
		endCursor: string | null
		calls: readonly { repository: string; search: string; cursor: string | null }[]
	}
}

test("multi-repository pull request pagination resumes short pages without duplicates when page size shrinks", async () => {
	const result = await runScopedPageProbe("pullRequest")
	expect(result.first).toEqual(["owner/a#2", "owner/a#1"])
	expect(result.second).toEqual(["owner/b#3"])
	expect(result.third).toEqual(["owner/a#0"])
	expect(result.endCursor).toBeNull()
	expect(result.calls.every((call) => call.search.includes("author:@me"))).toBe(true)
})

test("multi-repository issue pagination resumes short pages without duplicates when page size shrinks", async () => {
	const result = await runScopedPageProbe("issue")
	expect(result.first).toEqual(["owner/a#2", "owner/a#1"])
	expect(result.second).toEqual(["owner/b#3"])
	expect(result.third).toEqual(["owner/a#0"])
	expect(result.endCursor).toBeNull()
	expect(result.calls.every((call) => call.search.includes("author:@me"))).toBe(true)
})

test("organization Actions catalog includes later pages without unrelated repositories", async () => {
	const output = await runIsolatedProbe(
		`
import { Effect, Layer, Schema } from "effect"
import { CommandRunner } from "./src/services/CommandRunner.ts"
import { GitHubService } from "./src/services/GitHubService.ts"
const commandRunner = Layer.succeed(CommandRunner, CommandRunner.of({
	run: () => Effect.die("Unexpected command"),
	runSchema: (schema, _command, args) => {
		const url = new URL(args[1], "https://api.github.com/")
		if (url.pathname !== "/orgs/acme/repos") return Effect.die("Unscoped catalog request")
		const entries = url.searchParams.get("page") === "1"
			? Array.from({ length: 100 }, (_, index) => ({ full_name: "acme/repo-" + index }))
			: [{ full_name: "acme/later" }, { full_name: "other/unrelated" }]
		return Schema.decodeUnknownEffect(schema)(entries)
	},
}))
const repositories = await Effect.runPromise(GitHubService.use((github) => github.listScopedRepositories()).pipe(
	Effect.provide(GitHubService.layerNoDeps.pipe(Layer.provide(commandRunner))),
))
console.log(JSON.stringify(repositories))
`,
		{ GHUI_ORG: "acme", GHUI_REPOSITORIES: "" },
	)
	expect(JSON.parse(output)).toEqual([...Array.from({ length: 100 }, (_, index) => `acme/repo-${index}`), "acme/later"])
})

test("repository catalog failures do not return a partial successful catalog", async () => {
	const output = await runIsolatedProbe(
		`
import { Effect, Layer, Schema } from "effect"
import { CommandError, CommandRunner } from "./src/services/CommandRunner.ts"
import { GitHubService } from "./src/services/GitHubService.ts"
const commandRunner = Layer.succeed(CommandRunner, CommandRunner.of({
	run: () => Effect.die("Unexpected command"),
	runSchema: (schema, command, args) => {
		const url = new URL(args[1], "https://api.github.com/")
		if (url.pathname !== "/user/repos") return Effect.die("Expected authenticated user catalog")
		if (url.searchParams.get("page") === "1") return Schema.decodeUnknownEffect(schema)(
			Array.from({ length: 100 }, (_, index) => ({ full_name: "acme/repo-" + index })),
		)
		return Effect.fail(new CommandError({ command, args, detail: "Catalog access denied", cause: "HTTP 403" }))
	},
}))
const result = await Effect.runPromise(GitHubService.use((github) => github.listScopedRepositories()).pipe(
	Effect.map(() => "unexpected success"),
	Effect.catch((error) => Effect.succeed(error.detail)),
	Effect.provide(GitHubService.layerNoDeps.pipe(Layer.provide(commandRunner))),
))
console.log(JSON.stringify(result))
`,
		{ GHUI_ORG: "", GHUI_REPOSITORIES: "" },
	)
	expect(JSON.parse(output)).toBe("Catalog access denied")
})
