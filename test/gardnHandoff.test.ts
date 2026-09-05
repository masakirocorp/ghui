import { expect, test } from "bun:test"
import { runIsolatedProbe } from "./isolatedProbe.ts"

const serviceImports = `
	import { Effect, Layer } from "effect"
	import { GardnHandoff } from "./src/services/GardnHandoff.ts"
	import { CommandRunner } from "./src/services/CommandRunner.ts"
	const layer = GardnHandoff.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
`

test("standalone ghui cannot send context to an ambient Gardn session", async () => {
	const output = await runIsolatedProbe(
		`${serviceImports}
		const outcome = await Effect.runPromise(GardnHandoff.use(service => service.listAgents()).pipe(
			Effect.provide(layer),
			Effect.match({ onFailure: error => error.detail, onSuccess: () => "unexpected success" }),
		))
		console.log(outcome)
	`,
		{ GARDN_BIN_PATH: "", GARDN_SOCKET_PATH: "" },
	)
	expect(output).toContain("Open ghui from Gardn")
})

test("a repository path cannot hand off an unrelated checkout", async () => {
	const output = await runIsolatedProbe(`${serviceImports}
		import { mkdtemp, rm } from "node:fs/promises"
		import { tmpdir } from "node:os"
		import { join } from "node:path"
		const root = await mkdtemp(join(tmpdir(), "ghui-checkout-"))
		try {
			for (const args of [["init", "-b", "main"], ["remote", "add", "origin", "https://github.com/other/repository.git"]]) {
				const result = Bun.spawnSync(["git", "-C", root, ...args])
				if (result.exitCode !== 0) throw new Error(result.stderr.toString())
			}
			process.env.GARDN_BIN_PATH = join(root, "must-not-run")
			process.env.GARDN_SOCKET_PATH = join(root, "session.sock")
			process.env.GHUI_REPOSITORY_PATHS = JSON.stringify({ "owner/repository": root })
			const outcome = await Effect.runPromise(GardnHandoff.use(service => service.openCheckout("owner/repository")).pipe(
				Effect.provide(layer),
				Effect.match({ onFailure: error => error.detail, onSuccess: () => "unexpected success" }),
			))
			console.log(outcome)
		} finally { await rm(root, { recursive: true, force: true }) }
	`)
	expect(output).toContain("No local checkout matches owner/repository")
})

test("review handoff preserves an existing branch that advanced beyond the PR snapshot", async () => {
	const output = await runIsolatedProbe(`${serviceImports}
		import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
		import { tmpdir } from "node:os"
		import { join } from "node:path"
		import { mergeQueuePullRequest } from "./test/fixtures/mergeQueue.ts"
		const root = await mkdtemp(join(tmpdir(), "ghui-review-safety-"))
		const bin = join(root, "bin")
		const git = (...args) => {
			const result = Bun.spawnSync(["git", "-C", root, ...args])
			if (result.exitCode !== 0) throw new Error(result.stderr.toString())
			return result.stdout.toString().trim()
		}
		try {
			await mkdir(bin)
			await writeFile(join(bin, "gardn"), ${JSON.stringify('#!/bin/sh\nprintf \'%s\\n\' \'{"result":{"type":"workspace_list","workspaces":[]}}\'\n')}, { mode: 0o755 })
			await writeFile(join(bin, "wt"), ${JSON.stringify('#!/bin/sh\n[ "$1" = "--version" ] || exit 80\nprintf \'worktrunk probe\\n\'\n')}, { mode: 0o755 })
			git("init", "-b", "main")
			git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "--allow-empty", "-m", "existing work")
			git("remote", "add", "origin", "https://github.com/owner/repository.git")
			const head = git("rev-parse", "HEAD")
			const pr = { ...mergeQueuePullRequest, repository: "owner/repository", number: 1, headRefOid: "a".repeat(40) }
			const branch = "ghui-review-owner-repository-1-aaaaaaaaaaaa"
			git("branch", branch)
			process.env.PATH = bin + ":" + process.env.PATH
			process.env.GARDN_BIN_PATH = join(bin, "gardn")
			process.env.GARDN_SOCKET_PATH = join(root, "session.sock")
			process.env.GHUI_REPOSITORY_PATHS = JSON.stringify({ "owner/repository": root })
			const outcome = await Effect.runPromise(GardnHandoff.use(service => service.createReviewSpace(pr)).pipe(
				Effect.provide(layer),
				Effect.match({ onFailure: error => error.detail, onSuccess: () => "unexpected success" }),
			))
			console.log(JSON.stringify({ outcome, unchanged: git("rev-parse", "HEAD") === head && git("rev-parse", branch) === head, branch: git("branch", "--show-current") }))
		} finally { await rm(root, { recursive: true, force: true }) }
	`)
	const result = JSON.parse(output)
	expect(result.outcome).toContain("has changed")
	expect(result.unchanged).toBe(true)
	expect(result.branch).toBe("main")
})

test("review handoff preserves uncommitted changes instead of presenting them as the PR snapshot", async () => {
	const output = await runIsolatedProbe(`${serviceImports}
		import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
		import { tmpdir } from "node:os"
		import { join } from "node:path"
		import { mergeQueuePullRequest } from "./test/fixtures/mergeQueue.ts"
		const root = await mkdtemp(join(tmpdir(), "ghui-review-dirty-"))
		const checkout = join(root, "checkout")
		const review = join(root, "review")
		const bin = join(root, "bin")
		const git = (...args) => {
			const result = Bun.spawnSync(["git", "-C", checkout, ...args])
			if (result.exitCode !== 0) throw new Error(result.stderr.toString())
			return result.stdout.toString().trim()
		}
		try {
			await mkdir(checkout)
			await mkdir(bin)
			git("init", "-b", "main")
			await writeFile(join(checkout, "work.txt"), "PR snapshot")
			git("add", "work.txt")
			git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-m", "snapshot")
			git("remote", "add", "origin", "ssh://git@github.com/owner/repository.git")
			const head = git("rev-parse", "HEAD")
			const branch = "ghui-review-owner-repository-1-" + head.slice(0, 12)
			git("worktree", "add", "-b", branch, review, head)
			await writeFile(join(review, "work.txt"), "Uncommitted review work")
			await writeFile(join(bin, "gardn"), ${JSON.stringify('#!/bin/sh\nprintf \'%s\\n\' \'{"result":{"type":"workspace_list","workspaces":[]}}\'\n')}, { mode: 0o755 })
			const worktreeJson = JSON.stringify({ path: review, branch })
			await writeFile(join(bin, "wt"), "#!/bin/sh\\nprintf '%s\\\\n' '" + worktreeJson + "'\\n", { mode: 0o755 })
			process.env.PATH = bin + ":" + process.env.PATH
			process.env.GARDN_BIN_PATH = join(bin, "gardn")
			process.env.GARDN_SOCKET_PATH = join(root, "session.sock")
			process.env.GHUI_REPOSITORY_PATHS = JSON.stringify({ "owner/repository": checkout })
			const pr = { ...mergeQueuePullRequest, repository: "owner/repository", number: 1, headRefOid: head }
			const outcome = await Effect.runPromise(GardnHandoff.use(service => service.createReviewSpace(pr)).pipe(
				Effect.provide(layer),
				Effect.match({ onFailure: error => error.detail, onSuccess: () => "unexpected success" }),
			))
			console.log(JSON.stringify({ outcome, content: await readFile(join(review, "work.txt"), "utf8"), branch: git("branch", "--show-current") }))
		} finally { await rm(root, { recursive: true, force: true }) }
	`)
	const result = JSON.parse(output)
	expect(result.outcome).toContain("uncommitted changes")
	expect(result.content).toBe("Uncommitted review work")
	expect(result.branch).toBe("main")
})
