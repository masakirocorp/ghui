import { useEffect, useMemo, useRef, type MutableRefObject } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { colors } from "../ui/colors.js"
import { SelectableRow, useHoverState } from "../ui/listSelection/SelectableRow.js"
import { fitCell, PlainLine, SectionTitle, TextLine } from "../ui/primitives.js"
import { overviewLoad, overviewAtom, type OverviewData } from "../ui/overview/atoms.js"
import { useAtomValue } from "@effect/atom-react"
import type { OverviewRow } from "./overviewRows.js"
import { buildOverviewRows } from "./overviewRows.js"

export interface OverviewSurfaceProps {
	readonly width: number
	readonly height: number
	readonly selectedIndex: number
	readonly onSelect: (index: number) => void
	readonly onActivate: (row: OverviewRow) => void
	readonly detail: OverviewRow | null
	readonly onBack: () => void
	readonly openBrowser: (url: string) => void
	readonly detailScrollRef: MutableRefObject<ScrollBoxRenderable | null>
}

const statusText = (row: OverviewRow): string => {
	if (row.kind === "issue") return `#${row.issue.number} · assigned`
	if (row.pullRequest.checkStatus === "failing") return "checks failed"
	if (row.pullRequest.reviewStatus === "changes") return "changes requested"
	if (row.section === "needs-attention") return "review requested"
	return "authored"
}

const rowTitle = (row: OverviewRow): string => (row.kind === "issue" ? row.issue.title : row.pullRequest.title)
const rowRepository = (row: OverviewRow): string => (row.kind === "issue" ? row.issue.repository : row.pullRequest.repository)
const rowNumber = (row: OverviewRow): number => (row.kind === "issue" ? row.issue.number : row.pullRequest.number)

const OverviewItem = ({
	row,
	selected,
	width,
	onSelect,
	onActivate,
	hovered,
	onHoverChange,
}: {
	readonly row: OverviewRow
	readonly selected: boolean
	readonly width: number
	readonly onSelect: () => void
	readonly onActivate: () => void
	readonly hovered: boolean
	readonly onHoverChange: (hovered: boolean) => void
}) => (
	<SelectableRow
		width={width}
		selected={selected}
		hovered={hovered}
		onSelect={() => {
			onSelect()
			onActivate()
		}}
		onHoverChange={onHoverChange}
	>
		{(rowBg) => {
			const meta = `${rowRepository(row)} #${rowNumber(row)} · ${statusText(row)}`
			return (
				<>
					<TextLine width={width} bg={rowBg} fg={selected ? colors.selectedText : colors.text}>
						<span fg={selected ? colors.accent : colors.count}>› </span>
						<span>{fitCell(rowTitle(row), Math.max(8, width - 2))}</span>
					</TextLine>
					<TextLine width={width} bg={rowBg} fg={colors.muted}>
						<span>{fitCell(meta, Math.max(1, width - 2))}</span>
					</TextLine>
				</>
			)
		}}
	</SelectableRow>
)

const OverviewSection = ({
	title,
	rows,
	selectedIndex,
	indexOffset,
	width,
	onSelect,
	onActivate,
}: {
	readonly title: string
	readonly rows: readonly OverviewRow[]
	readonly selectedIndex: number
	readonly indexOffset: number
	readonly width: number
	readonly onSelect: (index: number) => void
	readonly onActivate: (row: OverviewRow) => void
}) => {
	const { isHovered, onHoverChange } = useHoverState<number>()
	return (
		<box width={width} flexDirection="column">
			<SectionTitle title={title} />
			{rows.length === 0 ? <PlainLine text="  Nothing requiring attention." fg={colors.muted} /> : null}
			{rows.map((row, index) => {
				const selectionIndex = indexOffset + index
				return (
					<OverviewItem
						key={`${row.kind}:${rowRepository(row)}#${rowNumber(row)}`}
						row={row}
						selected={selectionIndex === selectedIndex}
						width={width}
						onSelect={() => onSelect(selectionIndex)}
						onActivate={() => onActivate(row)}
						hovered={isHovered(index)}
						onHoverChange={onHoverChange(index)}
					/>
				)
			})}
		</box>
	)
}

export const OverviewSurface = ({ width, height, selectedIndex, onSelect, onActivate, detail, onBack, openBrowser, detailScrollRef }: OverviewSurfaceProps) => {
	const result = useAtomValue(overviewAtom)
	const load = overviewLoad(result)
	const rows = useMemo(() => (load.status === "ready" ? buildOverviewRows(load.data) : []), [load])
	const scrollRef = useRef<ScrollBoxRenderable | null>(null)
	useEffect(() => {
		const scroll = scrollRef.current
		if (!scroll || detail) return
		const row = selectedIndex * 2 + 3
		if (row < scroll.scrollTop) scroll.scrollTo(row)
		else if (row + 2 > scroll.scrollTop + height) scroll.scrollTo(Math.max(0, row - height + 2))
	}, [selectedIndex, height, detail])
	if (detail) {
		const item = detail.kind === "issue" ? detail.issue : detail.pullRequest
		return (
			<box width={width} height={height} flexDirection="column" paddingLeft={1} paddingRight={1}>
				<TextLine onMouseDown={onBack}>
					<span fg={colors.accent}>‹ Back to overview</span>
				</TextLine>
				<SectionTitle title={item.title} />
				<PlainLine text={`${item.repository} #${item.number} · ${statusText(detail)}`} fg={colors.muted} />
				<TextLine onMouseDown={() => openBrowser(item.url)}>
					<span fg={colors.link}>Open on GitHub</span>
				</TextLine>
				<scrollbox ref={detailScrollRef} height={Math.max(1, height - 4)} focusable={false}>
					<text fg={colors.text} wrapMode="word">
						{item.body || "No description provided."}
					</text>
				</scrollbox>
			</box>
		)
	}
	if (load.status === "loading") return <PlainLine text="- Loading overview…" fg={colors.muted} />
	if (load.status === "error") return <PlainLine text={`- ${load.message || "Could not load overview."}`} fg={colors.error} />
	const sections = [
		["Needs your attention", rows.filter((row) => row.section === "needs-attention")],
		["Authored pull requests", rows.filter((row) => row.section === "authored")],
		["Assigned issues", rows.filter((row) => row.section === "assigned")],
	] as const
	let offset = 0
	return (
		<scrollbox ref={scrollRef} width={width} height={height} paddingLeft={1} paddingRight={1} focusable={false}>
			{sections.map(([title, sectionRows]) => {
				const currentOffset = offset
				offset += sectionRows.length
				return (
					<OverviewSection
						key={title}
						title={title}
						rows={sectionRows}
						selectedIndex={selectedIndex}
						indexOffset={currentOffset}
						width={Math.max(1, width - 2)}
						onSelect={onSelect}
						onActivate={onActivate}
					/>
				)
			})}
		</scrollbox>
	)
}

export type { OverviewData }
