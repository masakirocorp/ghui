import { colors } from "../colors.js"
import { fitCell, HintRow, PlainLine, standardModalDims, StandardModal, TextLine } from "../primitives.js"
import type { OpenRepositoryModalState } from "./types.js"

export const OpenRepositoryModal = ({
	state,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
	repositories,
	onChoose,
}: {
	state: OpenRepositoryModalState
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
	readonly repositories: readonly string[]
	readonly onChoose: (repository: string | null) => void
}) => {
	const { contentWidth, bodyHeight } = standardModalDims(modalWidth, modalHeight)
	const inputText = state.query.length > 0 ? state.query : "owner/name or GitHub URL"

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title="Choose repository scope"
			headerRight={{ text: "owner/name" }}
			subtitle={
				<TextLine>
					<span fg={colors.count}>› </span>
					<span fg={state.query.length > 0 ? colors.text : colors.muted}>{fitCell(inputText, Math.max(1, contentWidth - 2))}</span>
				</TextLine>
			}
			bodyPadding={1}
			footer={
				<HintRow
					items={[
						{ key: "enter", label: "open / home" },
						{ key: "ctrl-u", label: "clear" },
						{ key: "ctrl-w", label: "word" },
						{ key: "esc", label: "cancel" },
					]}
				/>
			}
		>
			<scrollbox height={bodyHeight} focusable={false}>
				<TextLine onMouseDown={() => onChoose(null)}>
					<span fg={colors.accent}>HOME · launch scope</span>
				</TextLine>
				{repositories
					.filter((repository) => repository.toLowerCase().includes(state.query.toLowerCase()))
					.map((repository) => (
						<TextLine key={repository} onMouseDown={() => onChoose(repository)}>
							<span fg={colors.link}>{repository}</span>
						</TextLine>
					))}
				{state.error ? (
					<PlainLine text={fitCell(state.error, contentWidth)} fg={colors.error} />
				) : (
					<PlainLine text={fitCell("Type owner/repo to explore. Empty input returns HOME.", contentWidth)} fg={colors.muted} />
				)}
			</scrollbox>
		</StandardModal>
	)
}
