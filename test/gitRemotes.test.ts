import { expect, test } from "bun:test"
import { parseGitRemoteUrl } from "../src/gitRemotes.ts"

test("SSH URL origins identify GitHub repositories without trusting lookalike hosts", () => {
	expect(parseGitRemoteUrl("ssh://git@github.com/owner/repository.git")).toBe("owner/repository")
	expect(parseGitRemoteUrl("ssh://git@github.com.evil.invalid/owner/repository.git")).toBeNull()
	expect(parseGitRemoteUrl("ssh://github.com@evil.invalid/owner/repository.git")).toBeNull()
})
