# ghui

Masakiro-maintained fork of [`kitlangton/ghui`](https://github.com/kitlangton/ghui),
used by Gardn as its terminal GitHub workspace. It retains the upstream ghui
product and Kit Langton's original credit while adding launch-scoped controls
for repository scope, Gardn handoffs, and terminal presentation.

Terminal UI for keeping up with your open GitHub pull requests across repositories.

`ghui` gives you one keyboard-driven place to review PR details, inspect diffs, leave diff comments, manage labels, toggle draft state, merge, open PRs in GitHub, and copy PR metadata without leaving the terminal.

<img width="1420" height="856" alt="image" src="https://github.com/user-attachments/assets/5e560a4a-5887-4baa-a6d4-e1f4f0410c70" />

Install the Masakiro companion release through Homebrew:

```bash
brew install masakirocorp/tap/ghui
```

Homebrew installs a standalone `ghui` binary, so you do not need Bun or npm at
runtime. Upgrade it with:

```bash
brew upgrade masakirocorp/tap/ghui
```

Release archives and checksums are also available from the
[`masakirocorp/ghui` releases](https://github.com/masakirocorp/ghui/releases).
Each archive includes the upstream MIT license.

Requirements:

- GitHub CLI installed and authenticated with `gh auth login`

Run it from anywhere:

```bash
ghui
```

## Local Development

Clone, install, and link:

```bash
git clone https://github.com/masakirocorp/ghui.git
cd ghui
bun install
bun link
```

The `main` branch is the Masakiro product branch. Maintainers sync
`kitlangton/ghui` through explicit upstream merges and preserve Masakiro launch
contracts when resolving differences.

With Nix flakes:

```bash
nix develop
bun install
bun run dev
```

## Configuration

- `GHUI_PR_FETCH_LIMIT`: max PRs fetched, defaults to `200`
- `GHUI_RUN_FETCH_LIMIT`: max workflow runs fetched per PR, defaults to `20`
- `GHUI_THEME`: launch-only fixed theme override, such as `system`; invalid theme IDs are ignored
- `GHUI_ORG`: launch-only GitHub organization scope
- `GHUI_REPOSITORIES`: launch-only JSON array of `owner/repo` identities; takes precedence over `GHUI_ORG`
- `GHUI_WORKSPACE_NAME`: Gardn Space name displayed for the launch
- `GHUI_REPOSITORY_PATHS`: JSON object mapping repository identities to local checkouts for Gardn handoffs
- `GHUI_SHOW_SCROLLBARS`: launch-only scrollbar override, set to `true` to show scrollbar rails
- `GHUI_SYSTEM_THEME_AUTO_RELOAD`: launch-only system theme reload override; accepts `true` or `false`

Pass `--org <login>` to scope the launch to an organization. Repeat
`--repo <owner/repo>` to select one or more repositories. CLI scope options
override environment scope. `--org` and `--repo` cannot be combined.
Repository identities are case-insensitive and duplicates are removed.
Invalid scope values fail before the TUI starts. An empty environment value
means no override, but an empty repository array is invalid.

The launch scope filters HOME queues and the repository catalog. Selecting
a repository narrows that scope. Returning HOME restores the launch scope,
not an unrestricted GitHub view. Explicit outside-scope repository views
remain available. Scope is never written to configuration and does not
change when a shell changes directories.

`GHUI_SHOW_SCROLLBARS` and `GHUI_SYSTEM_THEME_AUTO_RELOAD` take precedence
over their saved settings for that launch only. Boolean overrides accept the
exact values `true` and `false`. Missing or invalid values preserve the saved
settings. Launch overrides do not rewrite `config.json`.

Example:

```bash
GHUI_ORG=kitlangton ghui
ghui --org kitlangton
ghui --repo masakirocorp/gardn --repo masakirocorp/ghui
GHUI_REPOSITORIES='["masakirocorp/gardn","masakirocorp/ghui"]' ghui
GHUI_SHOW_SCROLLBARS=true ghui --org kitlangton
GHUI_THEME=system GHUI_SYSTEM_THEME_AUTO_RELOAD=true ghui
```

Gardn launches ghui with `GHUI_THEME=system`,
`GHUI_SYSTEM_THEME_AUTO_RELOAD=true`, and its terminal color protocol. These
launch overrides apply only to that process and do not rewrite `config.json`.
You can also copy `.env.example` to `.env` and edit the values locally.

ghui stores UI preferences in `config.json` under `GHUI_CONFIG_DIR` when set,
otherwise under the platform config directory. On Linux this is normally
`~/.config/ghui/config.json`.

Example:

```json
{
	"theme": "system",
	"systemThemeAutoReload": true,
	"showScrollbars": false
}
```

`systemThemeAutoReload` defaults to `false`. Set it to `true` to let external
theme reload signals update the active system theme palette while ghui is
running.

Scrollable panes hide their scrollbar rails by default. Set `showScrollbars`
to `true` to display them while retaining the same keyboard and mouse scrolling
behavior.

### Open in editor

Press `e` on a pull request (in the list, detail, or diff view) to hand it off
to your editor. ghui suspends the TUI, runs your command attached to the
terminal, and resumes when it exits.

Configure this in `config.json`:

```json
{
	"editorCommand": "tmux new-window -c {{repoPath}} 'gh pr checkout {{number}} && nvim -c \":DiffviewOpen {{baseRef}}...{{headRef}}\"'",
	"repoPaths": {
		"kitlangton/ghui": "~/code/ghui",
		"kitlangton/*": "~/code/repos/kitlangton/*",
		":owner/:repo": "~/src/github.com/:owner/:repo"
	}
}
```

`repoPaths` maps a repository to a local clone, matched in order: an exact
`owner/repo` key, then an owner wildcard (`owner/*`, where `*` becomes the repo
name), then the generic `:owner/:repo` template. `~` expands to your home
directory.

`editorCommand` is a shell command template with these substitutions:

- `{{repo}}` — full `owner/repo`
- `{{owner}}`, `{{name}}`
- `{{number}}` — PR number
- `{{headRef}}` — PR head branch
- `{{baseRef}}` — base branch
- `{{author}}`
- `{{url}}`
- `{{repoPath}}` — resolved local path (requires a matching `repoPaths` entry)

If `editorCommand` is omitted, ghui falls back to `$VISUAL`/`$EDITOR` opening
the resolved `repoPath`. Some common recipes:

```jsonc
// diffview.nvim: checkout the branch and diff against base
"editorCommand": "tmux new-window -c {{repoPath}} 'gh pr checkout {{number}} && nvim -c \":DiffviewOpen {{baseRef}}...{{headRef}}\"'"

// octo.nvim: review via the GitHub API (no checkout)
"editorCommand": "tmux new-window -c {{repoPath}} 'nvim -c \":silent Octo pr edit {{number}}\"'"

// VS Code
"editorCommand": "code {{repoPath}}"
```

### Workflow runs

Press `a` on a pull request to open its **GitHub Actions runs** full-screen,
scoped to the PR's head commit:

- The runs list shows each workflow run with status, conclusion, duration, and age.
- `enter` drills into a run to see its jobs and steps; failing steps are easy to spot.
- `n` / `p` jump between failures, `enter` expands a step, `o` opens the run in your browser, `r` refreshes, and `esc` walks back out.

Requires the GitHub CLI (`gh`) the same as the rest of ghui; nothing extra to configure.

### Overview and repository-wide Actions

Gardn launches open Overview with authored pull requests, requested reviews,
and assigned issues. Click an item to read its details. Use the command palette
to open its checkout, create a review Space, or preview an agent handoff.

Actions lists workflow runs across the current scope. It loads only when you
open the tab. Click the filter to cycle all, failed, and running workflows.
Click a run to inspect jobs and steps. Click a step to open its GitHub log.
Press `r` to refresh and `esc` to return to the list.

Click the scope header or press `g s` to choose a repository. Click the Space
name in a narrowed view, or choose HOME in the picker, to restore launch scope.
Press `g v` for Overview and `g a` for Actions.

### Gardn handoffs

Gardn launches provide an explicit binary path and session socket. Standalone
launches do not fall back to an ambient Gardn session.

Checkout handoffs verify that a local Git remote matches the selected
repository. ghui uses `GHUI_REPOSITORY_PATHS`, then `repoPaths`, then the
current directory to locate that checkout.

Review Spaces require Worktrunk. ghui fetches the selected pull request
snapshot and creates a separate worktree without running Worktrunk hooks.
It leaves the original checkout on its current branch. Repeating the handoff
reuses the review Space. If its branch changed or it contains uncommitted work,
ghui preserves that work and reports an error.

Agent handoffs send repository, URL, commit, and status context to an
explicitly selected agent. They do not send pull request bodies or
automatically ask the agent to edit code.

## Keybindings

- `up` / `down`: move selection
- `k` / `j`: move selection
- `gg` / `G`: jump to first or last pull request
- `ctrl-u` / `ctrl-d`: page up or down
- `tab` / `shift-tab`: switch PR queue
- `ctrl-p` / `cmd-k`: open the command palette
- `/`: filter
- `enter`: expand details; normal PR actions still work while details are expanded
- `esc`: return from expanded details, leave diff/comment mode, or close modal
- `r`: refresh
- `d`: view stacked diff for all changed files
- `a`: view this PR's GitHub Actions runs (jobs, steps, and failing logs)
- `shift-r`: review or approve the selected pull request
- `up` / `down` / `pageup` / `pagedown`: move comment target while viewing a diff
- `enter`: open a commented diff line, or start a comment on an uncommented line
- `v`: start or clear a multi-line diff comment range
- `n` / `p`: jump between diff comment threads
- `f`: open the changed-files navigator while viewing a diff
- `left` / `right`: choose the deleted or added side while in split diff comment mode
- `[` / `]`: switch files while viewing or commenting on a diff
- `s`: toggle draft or ready-for-review state
- `m`: merge
- `x`: close with confirmation
- `t`: choose a fixed theme, including `System` to match your terminal colors; press `m` in the theme picker to follow the OS light/dark appearance with separate theme choices
- `l`: manage labels
- `o`: open PR in browser
- `e`: open PR in your editor (configurable; see `editorCommand` / `repoPaths`)
- `y`: copy PR metadata
- `q`: quit

Authored-only pull request views render compact one-line rows because the
author identity is implied by the active view. Mixed-author views continue to
show the author and branch metadata row.

Review submission:

- Press `shift-r` to open the review modal.
- Use `j` / `k` or `up` / `down` to choose Comment, Approve, or Request changes.
- Press `enter` to move to the optional summary area.
- Press `enter` again to submit, or `shift-enter` to insert a newline.
- Press `esc` from the summary to return to action selection; press `esc` from action selection to cancel.
