import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { colors } from "../colors.js"
import { fitCell, HintRow, PlainLine, StandardModal, standardModalDims, TextLine } from "../primitives.js"
import type { GardnAgentPickerState } from "./types.js"

export const GardnAgentPickerModal = ({
	state,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
	onSelect,
	onSend,
}: {
	readonly state: GardnAgentPickerState
	readonly modalWidth: number
	readonly modalHeight: number
	readonly offsetLeft: number
	readonly offsetTop: number
	readonly onSelect: (index: number) => void
	readonly onSend: () => void
}) => {
	const { rowWidth, bodyHeight } = standardModalDims(modalWidth, modalHeight)
	const selectedIndex = Math.max(0, Math.min(state.selectedIndex, Math.max(0, state.agents.length - 1)))
	const agentsRef = useRef<ScrollBoxRenderable | null>(null)
	const previewHeight = Math.max(1, Math.floor((bodyHeight - 2) / 2))
	const agentsHeight = Math.max(1, bodyHeight - previewHeight - 2)
	useEffect(() => {
		agentsRef.current?.scrollTo(Math.max(0, selectedIndex - agentsHeight + 1))
	}, [selectedIndex, agentsHeight])
	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title="Send context to Gardn agent"
			subtitle={<PlainLine text="Review context, choose an agent, then send." fg={colors.muted} />}
			footer={
				<HintRow
					items={[
						{ key: "↑↓", label: "move" },
						{ key: "enter", label: "send" },
						{ key: "esc", label: "cancel" },
					]}
				/>
			}
		>
			<scrollbox height={previewHeight} width={rowWidth} focusable={false}>
				<text fg={colors.text} wrapMode="word">
					{state.contextPreview || "No context selected."}
				</text>
			</scrollbox>
			{state.loading ? <PlainLine text="Loading agents…" fg={colors.muted} /> : null}
			{state.error ? <PlainLine text={fitCell(state.error, rowWidth)} fg={colors.error} /> : null}
			{!state.loading && state.agents.length === 0 ? <PlainLine text="No Gardn agents are available." fg={colors.muted} /> : null}
			<scrollbox ref={agentsRef} height={agentsHeight} width={rowWidth} focusable={false}>
				{state.agents.map((agent, index) => {
					const selected = index === selectedIndex
					return (
						<TextLine
							key={agent.target}
							width={rowWidth}
							bg={selected ? colors.selectedBg : undefined}
							fg={selected ? colors.selectedText : colors.text}
							onMouseDown={() => onSelect(index)}
						>
							<span fg={selected ? colors.accent : colors.muted}>{selected ? "›" : " "}</span>
							<span> </span>
							<span attributes={selected ? TextAttributes.BOLD : 0}>{fitCell(agent.name, Math.max(8, rowWidth - 18))}</span>
							<span fg={colors.muted}>{fitCell(agent.status, 16, "right")}</span>
						</TextLine>
					)
				})}
			</scrollbox>
			<TextLine
				width={rowWidth}
				onMouseDown={() => {
					if (!state.loading && !state.sending && state.agents.length > 0) onSend()
				}}
			>
				<span fg={colors.accent}>{state.sending ? "Sending…" : `Send to ${state.agents[selectedIndex]?.name ?? "selected agent"}`}</span>
			</TextLine>
		</StandardModal>
	)
}
