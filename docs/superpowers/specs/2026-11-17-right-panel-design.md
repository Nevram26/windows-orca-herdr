# Right panel: tabs, rail, Chats, Push and PR

## Why

The top bar is cluttered: Files, Changes and Excalidraw buttons sit next to the tabs. The user
wants those controls on the right side, wants to find and resume old agent conversations per
project, and wants to push and open a PR without leaving Herdr.

## What gets built

### 1. Panel tabs and the rail

**Panel open.** The right panel (`panel` column in `layouts/orca.json`) gets a tab strip at its
top: **Files · Changes · Chats · Draw**. Files, Changes and Chats switch the `panel-body` stack.
Draw doesn't switch anything: it opens Excalidraw as the popup it is today
(`mod.open {name:"excalidraw"}`). The top bar keeps **Add action** (`t3-actions`) and the panel
hide/show button (`panel-toggle`); neither goes inside the panel.

**Panel minimized.** The panel collapses to a thin icon rail on the right edge of `work-body`.
The top bar loses Add action and the panel button; the rail holds, top to bottom:
show-panel, Add action, a divider, then Files, Changes, Chats, Excalidraw icons. Clicking
Files/Changes/Chats opens the panel on that tab; Excalidraw opens its popup; show-panel opens
the panel on its last tab.

**Removed from the top bar:** the Files, Changes and Excalidraw buttons in `my-tabs`
(`mods/my-tabs/main.js`, the `panelButton(...)` calls and the `excalidraw` element). Its
per-space panel memory (`syncPanel`) stays and keeps working.

The panel toggle key command (`toggle-panel`) must keep working and also flip the rail.

Files, Changes and Chats always show as tabs, whatever `workspace.panels` says. Widen the
`enabled` filter in `my-tabs`' `syncPanel` to include `chats`, so a space that remembers Chats
reopens on it instead of closing the panel (builder's call).

When actions exist, `t3-actions` shows a ~108px "▶ Run <name> | ▾" control that doesn't fit the
rail: the rail shows one icon that opens the actions menu, via a new icon-only view of
`t3-actions` (builder's call).

### 2. Chats

A new stack child `chats` in `panel-body`, drawn by a new mod. It lists past Claude Code and
Codex conversations for the **active space's project**, newest first, both programs mixed.

- **Which project:** the active space's repo root (from its first terminal's cwd, as the other
  mods do). Conversations whose folder is that repo or one of its worktrees count
  (`git worktree list` gives the live worktree paths; a chat in a live `TrackSort-wt/<name>`
  worktree shows under TrackSort). Path comparison is case-insensitive and treats `\` and `/` alike (Windows
  paths in these files mix both and differ in case, e.g. `documents\coding` vs `Documents\Coding`).
- **Only resumable chats show (user's decision):** hide a chat whose folder no longer exists
  (deleted worktrees), and (builder's call) a Claude chat whose transcript
  `~/.claude/projects/<slug>/<sessionId>.jsonl` is gone, or a Codex one with no rollout file.
  Hide Codex sub-agent threads (rollout `session_meta` has `parent_thread_id`, e.g. "Guardian
  review") (builder's call).
- **Each row:** program icon (Claude or Codex), title, which worktree/branch folder it was in,
  and how long ago it was last used.
- **Click a row:** if that conversation is already running in a live terminal, focus it
  instead (builder's call; match by the session id hibernate's `describe()` finds). Otherwise
  resume it in a **new tab in the active space**, in the conversation's own folder, always with
  permission prompts off (user's decision): `claude --dangerously-skip-permissions --resume
  <id>`, `codex resume --yolo <id>`. Reuse `commandLine` from `mods/hibernate/core.js` to build
  the PowerShell line; import or copy, builder's choice.
- **Data sources** (read on open and on refresh; never parse every transcript in full):
  - Claude: `~/.claude/history.jsonl`, one line per prompt with `project`, `sessionId`,
    `display`, `timestamp`. Group by `sessionId`: title = first `display`, last used = max
    `timestamp`, folder = `project`.
  - Codex: the rollout files `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl` are the master
    list (some sessions aren't in the index); read only each one's first line
    (`session_meta.payload.cwd`, `parent_thread_id`). Title from
    `~/.codex/session_index.jsonl` `thread_name`, else the first `text` for that `session_id` in
    `~/.codex/history.jsonl`. Last used from the index's `updated_at`, else the file's modified
    time (builder's call).
- Empty state when the space has no repo or no chats.

### 3. Push and Create PR

In the Changes tab, under or above Better Changes (munza's mod, not in this repo: don't edit
it). Make the `changes` stack child a column of Better Changes plus a small new block with two
buttons.

- **Push:** `git push` on the current branch; `git push -u origin <branch>` when it has no
  upstream. Show the result (success, or git's error) in the block.
- **Create PR:** push first (as above), then open a small box with the title and description
  prefilled from the branch's commits against the default branch (one commit: its subject and
  body; several: first subject as title, the subjects as a bullet list as the body). The user
  edits and confirms; it runs `gh pr create --title ... --body ...` and shows the PR link.
  If the branch already has an open PR, show its link instead of the button.
- Both disabled in a space with no repo. Create PR is disabled on the default branch; Push
  works on any branch (builder's call).

## Non-goals

- Changing Better Changes or Excalidraw themselves.
- Searching chat contents, deleting chats, or chats from other agents (pi, etc.).
- PR options beyond title and body (reviewers, labels, draft).

## Constraints

- Windows first (this is the Windows port), but don't break macOS: no `sh -c` on Windows,
  PowerShell 5.1 for any shelling, as the hibernate mod does.
- Herdr mods run gpui-kit JS: no DOM, Node APIs or `setTimeout`. Types are in
  `~/.config/herdr-app/herdr.d.ts` and `gpui-kit.d.ts`.
- Develop in `~/.config/herdr-app` (the live copy Herdr runs), then copy the changed mods and
  layout back into this repo. `sync.sh` uses `rsync` and `orca-2.json`, neither of which exists
  here; copy by hand. Live `better-sidebar/views/spaces.js` and `hibernate/` already differ
  from the repo: don't overwrite those live files with repo copies.
- Every mod passes `herdr-app check <mod folder>`; check the window with `herdr-app shot`.

## Icons (user's decision)

Use **Lucide** icons (the set shadcn/ui uses) for every new icon: tab strip, rail, Chats rows,
Push/PR bar, PR box. Vendor each as an `.svg` file inside the mod that draws it (Herdr's
`svg("mods/<mod>/<file>.svg")` loads files; no npm, no CDN at run time). Suggested: `panel-right`
(show/hide panel), `play` (actions), `folder` (Files), `git-compare` (Changes),
`messages-square` (Chats), `pencil-line` (Excalidraw), `arrow-up-from-line` (Push),
`git-pull-request-arrow` (Create PR), `refresh-cw` (Chats refresh). Reuse an existing icon if
the repo already ships the same Lucide one. Claude/Codex row icons stay the program icons
Herdr already has (`icon(program)` in `better-sidebar/views/agents.js`).

## Left to the builder

Exact sizes and spacing (match the existing chrome), whether the tab strip and rail are
one new mod or views of `better-sidebar`, refresh timing for Chats, and how the PR box is
drawn (overlay popup vs inline).
