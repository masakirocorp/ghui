import * as Atom from "effect/unstable/reactivity/Atom"
import { GardnHandoff, type GardnHandoffContext } from "./GardnHandoff.js"
import { githubRuntime } from "./runtime.js"

export const gardnContextAtom = Atom.make<GardnHandoffContext | null>(null)

export const gardnListAgentsAtom = githubRuntime.fn<void>()(() => GardnHandoff.use((gardn) => gardn.listAgents()))
export const gardnSendContextAtom = githubRuntime.fn<{ readonly target: string; readonly context: GardnHandoffContext }>()(({ target, context }) =>
	GardnHandoff.use((gardn) => gardn.sendContext(target, context)),
)
