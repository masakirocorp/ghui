import { context } from "@ghui/keymap"

export interface GardnAgentPickerCtx {
	readonly close: () => void
	readonly send: () => void
	readonly moveSelection: (delta: -1 | 1) => void
	readonly visibleCount: number
	readonly loading: boolean
	readonly sending: boolean
}

const Picker = context<GardnAgentPickerCtx>()

export const gardnAgentPickerKeymap = Picker(
	{ id: "gardn-picker.escape", title: "Cancel", keys: ["escape"], run: (s) => s.close() },
	{ id: "gardn-picker.up", title: "Up", keys: ["up", "k", "ctrl+p"], enabled: (s) => s.visibleCount > 0, run: (s) => s.moveSelection(-1) },
	{ id: "gardn-picker.down", title: "Down", keys: ["down", "j", "ctrl+n"], enabled: (s) => s.visibleCount > 0, run: (s) => s.moveSelection(1) },
	{ id: "gardn-picker.send", title: "Send context", keys: ["return"], enabled: (s) => !s.loading && !s.sending && s.visibleCount > 0, run: (s) => s.send() },
)
