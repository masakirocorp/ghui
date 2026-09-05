import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runIsolatedProbe } from "./isolatedProbe.ts"

test("repository underscores cannot merge rollups from another launch scope", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ghui-scope-cache-"))
	try {
		const filename = join(directory, "cache.sqlite")
		const firstActivity = new Date(Date.now() - 60_000).toISOString()
		for (const [repository, number] of [
			["owner/a_b", 1],
			["owner/axb", 2],
		] as const) {
			await runIsolatedProbe(
				`
import { Effect } from "effect"
import { CacheService } from "./src/services/CacheService.ts"
const date = new Date(${JSON.stringify(number === 1 ? firstActivity : new Date().toISOString())})
const common = { repository: "owner/shared", number: ${number}, state: "open", title: "Shared item", body: "", author: "alice", labels: [], createdAt: date, updatedAt: date, url: "https://github.com/owner/shared" }
const pr = { ...common, headRefOid: "sha", headRefName: "topic", baseRefName: "main", defaultBranchName: "main", additions: 0, deletions: 0, changedFiles: 0, reviewStatus: "none", checkStatus: "none", checkSummary: "", checks: [], autoMergeEnabled: false, detailLoaded: true, closedAt: null }
const load = { view: { _tag: "Queue", mode: "authored", repository: null }, fetchedAt: date, endCursor: null, hasNextPage: false }
await Effect.runPromise(Effect.gen(function* () {
 const cache = yield* CacheService
 yield* cache.writeQueue("alice", { ...load, data: [pr] })
 yield* cache.writeIssueQueue("alice", { ...load, data: [{ ...common, commentCount: 0 }] })
}).pipe(Effect.provide(CacheService.layerSqliteFile(${JSON.stringify(filename)}))))
console.log("written")
`,
				{ GHUI_REPOSITORIES: JSON.stringify([repository, "owner/shared"]) },
			)
		}
		const output = await runIsolatedProbe(
			`
import { Effect } from "effect"
import { CacheService } from "./src/services/CacheService.ts"
const rows = await Effect.runPromise(CacheService.use(cache => cache.readRepoRollup("alice")).pipe(Effect.provide(CacheService.layerSqliteFile(${JSON.stringify(filename)}))))
console.log(JSON.stringify(rows))
`,
			{ GHUI_REPOSITORIES: JSON.stringify(["owner/a_b", "owner/shared"]) },
		)
		expect(JSON.parse(output)).toEqual([{ repository: "owner/shared", pullRequestCount: 1, issueCount: 1, lastActivityAt: firstActivity }])
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
