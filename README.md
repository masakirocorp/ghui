# ghui

Masakiro-maintained fork of [`kitlangton/ghui`](https://github.com/kitlangton/ghui),
used by Gardn as its terminal GitHub workspace. It retains the upstream ghui
product and Kit Langton's original credit while adding launch-scoped controls
for organization filtering and terminal presentation.

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
- `GHUI_SHOW_SCROLLBARS`: launch-only scrollbar override, set to `true` to show scrollbar rails

Pass `--org <login>` to scope the launch to an organization. The CLI option
overrides `GHUI_ORG`; organization logins must be 1-39 ASCII letters, digits,
or single hyphens. Invalid CLI and environment values fail before the TUI
starts. The organization scope filters HOME queues and repositories. Explicit
repository views remain unchanged, and the scope is never written to config.

`GHUI_SHOW_SCROLLBARS=true` takes precedence over the saved `showScrollbars`
setting for that launch only. It does not rewrite `config.json`.

Example:

```bash
GHUI_ORG=kitlangton ghui
ghui --org kitlangton
GHUI_SHOW_SCROLLBARS=true ghui --org kitlangton
```

Gardn may launch ghui with `GHUI_THEME=system` and its terminal color
protocol. Theme and organization overrides apply only to that process and do
not rewrite `config.json`.
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
