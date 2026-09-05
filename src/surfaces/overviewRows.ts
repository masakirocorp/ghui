import type { IssueItem, PullRequestItem } from "../domain.js"
import type { OverviewData } from "../ui/overview/atoms.js"

export type OverviewRow =
	| { readonly kind: "pullRequest"; readonly section: "needs-attention" | "authored"; readonly pullRequest: PullRequestItem }
	| { readonly kind: "issue"; readonly section: "assigned"; readonly issue: IssueItem }

const uniquePullRequests = (items: readonly PullRequestItem[]): readonly PullRequestItem[] => {
	const seen = new Set<string>()
	return items.filter((pullRequest) => {
		if (seen.has(pullRequest.url)) return false
		seen.add(pullRequest.url)
		return true
	})
}

export const buildOverviewRows = (data: OverviewData): readonly OverviewRow[] => {
	const actionable = uniquePullRequests([
		...data.requestedReviewPullRequests,
		...data.authoredPullRequests.filter((pullRequest) => pullRequest.checkStatus === "failing" || pullRequest.reviewStatus === "changes"),
	])
	return [
		...actionable.map((pullRequest) => ({ kind: "pullRequest", section: "needs-attention", pullRequest }) satisfies OverviewRow),
		...uniquePullRequests(data.authoredPullRequests).map((pullRequest) => ({ kind: "pullRequest", section: "authored", pullRequest }) satisfies OverviewRow),
		...data.assignedIssues.map((issue) => ({ kind: "issue", section: "assigned", issue }) satisfies OverviewRow),
	]
}
