import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useMemo, useRef } from "react"
import type { RunDetailRow } from "../ui/runs/runsRows.js"
import type { WorkflowRunDetails } from "../domain.js"
import { colors } from "../ui/colors.js"
import { SelectableRow, useHoverState } from "../ui/listSelection/SelectableRow.js"
import { fitCell, PlainLine, SectionTitle, TextLine } from "../ui/primitives.js"
import { actionRunDetailsFor, actionsAtom, actionsFilterAtom, actionsLoad, selectedActionRunAtom, type ActionRun, type ActionsFilter } from "../ui/actions/atoms.js"
import { flattenRunRows, conclusionLabel } from "../ui/runs/runsRows.js"

interface ActionsSurfaceProps {
	readonly width: number
	readonly height: number
	readonly selectedIndex: number
	readonly onSelect: (index: number) => void
	readonly openBrowser: (url: string) => void
}

const runLabel = (run: ActionRun): string => `${run.repository} · ${run.run.workflowName || run.run.displayTitle}`
const runStatus = (run: ActionRun): string => conclusionLabel(run.run.status, run.run.conclusion)
const failedRun = (run: ActionRun): boolean => run.run.conclusion === "failure" || run.run.conclusion === "timed_out" || run.run.conclusion === "action_required"
const runningRun = (run: ActionRun): boolean => run.run.status === "queued" || run.run.status === "in_progress"
export const filterActionRuns = (runs: readonly ActionRun[], filter: ActionsFilter): readonly ActionRun[] =>
	runs.filter((run) => filter === "all" || (filter === "failed" ? failedRun(run) : runningRun(run)))

const RunList = ({
	runs,
	selectedIndex,
	width,
	onSelect,
	onActivate,
}: {
	readonly runs: readonly ActionRun[]
	readonly selectedIndex: number
	readonly width: number
	readonly onSelect: (index: number) => void
	readonly onActivate: (run: ActionRun) => void
}) => {
	const { isHovered, onHoverChange } = useHoverState<number>()
	return (
		<box width={width} flexDirection="column">
			<SectionTitle title="Workflow runs" />
			{runs.length === 0 ? <PlainLine text="  No workflow runs in this scope." fg={colors.muted} /> : null}
			{runs.map((run, index) => (
				<SelectableRow
					key={`${run.repository}:${run.run.id}`}
					width={width}
					selected={index === selectedIndex}
					hovered={isHovered(index)}
					onSelect={() => {
						onSelect(index)
						onActivate(run)
					}}
					onHoverChange={onHoverChange(index)}
				>
					{(rowBg) => (
						<>
							<TextLine width={width} bg={rowBg} fg={index === selectedIndex ? colors.selectedText : colors.text}>
								<span fg={index === selectedIndex ? colors.accent : colors.count}>› </span>
								<span>{fitCell(runLabel(run), Math.max(8, width - 2))}</span>
							</TextLine>
							<TextLine width={width} bg={rowBg} fg={colors.muted}>
								<span>{fitCell(`${run.run.headBranch} · ${runStatus(run)} · #${run.run.number}`, Math.max(1, width - 2))}</span>
							</TextLine>
						</>
					)}
				</SelectableRow>
			))}
		</box>
	)
}

const DetailRow = ({
	row,
	index,
	selected,
	width,
	onSelect,
	onActivate,
	hovered,
	onHoverChange,
}: {
	readonly row: RunDetailRow
	readonly index: number
	readonly selected: boolean
	readonly width: number
	readonly onSelect: (index: number) => void
	readonly onActivate: (row: RunDetailRow) => void
	readonly hovered: boolean
	readonly onHoverChange: (hovered: boolean) => void
}) => {
	const title = row.kind === "job" ? row.job.name : row.step.name
	const prefix = row.kind === "job" ? "◆" : "  └"
	const status = row.kind === "job" ? conclusionLabel(row.job.status, row.job.conclusion) : conclusionLabel(row.step.status, row.step.conclusion)
	return (
		<SelectableRow
			width={width}
			selected={selected}
			hovered={hovered}
			onSelect={() => {
				onSelect(index)
				onActivate(row)
			}}
			onHoverChange={onHoverChange}
		>
			{(rowBg) => (
				<TextLine width={width} bg={rowBg} fg={selected ? colors.selectedText : colors.text}>
					<span fg={selected ? colors.accent : colors.muted}>{prefix} </span>
					<span>{fitCell(title, Math.max(8, width - 20))}</span>
					<span fg={colors.muted}>{fitCell(status, 16, "right")}</span>
				</TextLine>
			)}
		</SelectableRow>
	)
}

const RunDetail = ({
	run,
	repository,
	selectedIndex,
	width,
	onSelect,
	onActivate,
}: {
	readonly run: WorkflowRunDetails
	readonly repository: string
	readonly selectedIndex: number
	readonly width: number
	readonly onSelect: (index: number) => void
	readonly onActivate: (row: RunDetailRow) => void
}) => {
	const rows = useMemo(() => flattenRunRows(run), [run])
	const { isHovered, onHoverChange } = useHoverState<number>()
	return (
		<box width={width} flexDirection="column">
			<TextLine width={width}>
				<span fg={colors.accent} attributes={TextAttributes.BOLD}>
					{fitCell(run.displayTitle || run.workflowName, width)}
				</span>
			</TextLine>
			<TextLine width={width} fg={colors.muted}>
				<span>{fitCell(`${repository} · ${run.headBranch} · ${conclusionLabel(run.status, run.conclusion)}`, width)}</span>
			</TextLine>
			{rows.length === 0 ? <PlainLine text="  No jobs were reported for this run." fg={colors.muted} /> : null}
			{rows.map((row, index) => (
				<DetailRow
					key={row.kind === "job" ? `job:${row.job.id}` : row.key}
					row={row}
					index={index}
					selected={index === selectedIndex}
					width={width}
					onSelect={onSelect}
					onActivate={onActivate}
					hovered={isHovered(index)}
					onHoverChange={onHoverChange(index)}
				/>
			))}
		</box>
	)
}

export const ActionsSurface = ({ width, height, selectedIndex, onSelect, openBrowser }: ActionsSurfaceProps) => {
	const result = useAtomValue(actionsAtom)
	const load = actionsLoad(result)
	const [filter, setFilter] = useAtom(actionsFilterAtom)
	const selectedRun = useAtomValue(selectedActionRunAtom)
	const setSelectedActionRun = useAtomSet(selectedActionRunAtom)
	const detailResult = useAtomValue(actionRunDetailsFor(selectedRun ? `${selectedRun.repository}\u0000${selectedRun.run.id}` : ""))
	const scrollRef = useRef<ScrollBoxRenderable | null>(null)
	useEffect(() => {
		const scroll = scrollRef.current
		if (!scroll) return
		const row = selectedRun ? selectedIndex + 2 : selectedIndex * 2 + 2
		if (row < scroll.scrollTop) scroll.scrollTo(row)
		else if (row + 2 > scroll.scrollTop + height - 2) scroll.scrollTo(Math.max(0, row - height + 4))
	}, [selectedIndex, selectedRun, height, detailResult])
	const activateRun = (run: ActionRun) => {
		setSelectedActionRun(run)
		onSelect(0)
	}
	const activateDetail = (row: RunDetailRow) => {
		openBrowser(row.job.url)
	}
	if (load.status === "loading") return <PlainLine text="- Loading workflow runs…" fg={colors.muted} />
	if (load.status === "error") return <PlainLine text={`- ${load.message || "Could not load workflow runs."}`} fg={colors.error} />
	if (selectedRun !== null && (detailResult.waiting || AsyncResult.isFailure(detailResult))) {
		return (
			<box width={width} height={height} flexDirection="column">
				<TextLine
					onMouseDown={() => {
						setSelectedActionRun(null)
						onSelect(0)
					}}
				>
					<span fg={colors.accent}>‹ Back to workflow runs</span>
				</TextLine>
				<PlainLine text={detailResult.waiting ? "Loading run details…" : "Could not load run details. Press r to retry."} fg={detailResult.waiting ? colors.muted : colors.error} />
			</box>
		)
	}
	if (selectedRun !== null && AsyncResult.isSuccess(detailResult) && detailResult.value !== null) {
		return (
			<box width={width} height={height} paddingLeft={1} paddingRight={1} flexDirection="column">
				<TextLine
					width={width - 2}
					onMouseDown={() => {
						setSelectedActionRun(null)
						onSelect(0)
					}}
				>
					<span fg={colors.accent}>‹ Back to workflow runs</span>
				</TextLine>
				<scrollbox ref={scrollRef} height={Math.max(1, height - 1)} focusable={false}>
					<RunDetail
						run={detailResult.value}
						repository={selectedRun.repository}
						selectedIndex={selectedIndex}
						width={Math.max(1, width - 2)}
						onSelect={onSelect}
						onActivate={activateDetail}
					/>
				</scrollbox>
			</box>
		)
	}
	const visibleRuns = filterActionRuns(load.data.runs, filter)
	const nextFilter = filter === "all" ? "failed" : filter === "failed" ? "running" : "all"
	return (
		<scrollbox ref={scrollRef} width={width} height={height} paddingLeft={1} paddingRight={1} focusable={false}>
			{load.data.errors.map((error) => (
				<PlainLine key={error.repository} text={`- ${error.repository}: ${error.error ?? "Repository unavailable."}`} fg={colors.error} />
			))}
			<TextLine width={Math.max(1, width - 2)} onMouseDown={() => setFilter(nextFilter)}>
				<span fg={colors.muted}>Filter </span>
				<span fg={colors.accent} attributes={TextAttributes.BOLD}>
					{filter.toUpperCase()}
				</span>
				<span fg={colors.muted}> · click or use command palette to cycle all/failed/running</span>
			</TextLine>
			<RunList runs={visibleRuns} selectedIndex={selectedIndex} width={Math.max(1, width - 2)} onSelect={onSelect} onActivate={activateRun} />
		</scrollbox>
	)
}
