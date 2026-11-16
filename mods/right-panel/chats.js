// The Chats tab: this project's past Claude Code and Codex conversations, newest first.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, exec, home, window, spaces, panes, focused, layout, knownAgents, hc, appHome } from "herdr";
import * as fs from "fs/promises";
import { worktrees, claudeChats, codexChats, projectChats, ago } from "./data.js";

export const icon = (name, size = 14) => svg(`mods/right-panel/icons/${name}.svg`).size(size).flex_none();
export const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null);

// The active space's folder: the focused terminal's if it is in this space, else its first terminal's.
export function spaceCwd() {
  const s = spaces().find((x) => x.active);
  if (!s) return null;
  const f = focused(), tabs = new Set(s.tabs.map((c) => c.id));
  return (f?.space === s.id && f.cwd) || panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Every rollout's modified time and the start of its first line (it is far too big to read whole).
const SCAN_PS = "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $root = Join-Path $HOME '.codex/sessions'; if (Test-Path $root) { Get-ChildItem -LiteralPath $root -Recurse -Filter 'rollout-*.jsonl' | ForEach-Object { $b = New-Object byte[] 2048; $s = [IO.File]::Open($_.FullName, 'Open', 'Read', 'ReadWrite'); $n = $s.Read($b, 0, 2048); $s.Close(); $t = [Text.Encoding]::UTF8.GetString($b, 0, $n); $i = $t.IndexOf([char]10); if ($i -ge 0) { $t = $t.Substring(0, $i) }; $_.FullName + [char]9 + [DateTimeOffset]::new($_.LastWriteTimeUtc).ToUnixTimeMilliseconds() + [char]9 + $t } }";
const SCAN_SH = `find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' 2>/dev/null | while IFS= read -r f; do printf '%s\\t%s000\\t%s\\n' "$f" "$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")" "$(head -n1 "$f" | head -c 2048)"; done`;
async function rollouts() {
  const r = window()?.platform === "windows"
    ? await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCAN_PS], { timeout: 60000 })
    : await exec("sh", ["-c", SCAN_SH], { timeout: 60000 });
  return r.stdout.split("\n").flatMap((l) => { const [file, mtime, ...head] = l.replace(/\r$/, "").split("\t"); return file && head.length ? [{ file, mtime: Number(mtime), head: head.join("\t") }] : []; });
}
const text = (path) => fs.readFile(path, "utf8").catch(() => "");

// session id -> terminal address, for the agents running now. Hibernate's pass (every 30s) already finds each terminal's
// session id (its describe()), and keeps them in its state file; they count while hc ls still lists the terminal live.
// ponytail: up to 30s stale, and empty if the hibernate mod isn't running (a click then resumes instead of focusing).
async function running() {
  const state = JSON.parse((await text(`${appHome()}/data/hibernate/state.json`)) || "{}");
  const live = new Set((JSON.parse((await hc(["ls", "--json"])).stdout).terminals ?? []).filter((t) => t.state === "live").map((t) => t.address));
  return new Map(Object.values(state.rolling?.items ?? {}).filter((e) => e.session && live.has(e.address)).map((e) => [e.session, e.address]));
}

export class Chats {
  init(_p, cx) {
    cx.spawn(async (cx) => {
      const all = await knownAgents().catch(() => []);
      this.programs = Object.fromEntries(["claude", "codex"].map((k) => [k, all.find((a) => a.key === k)]));
      cx.notify();
    });
    this.programs = null;
    this.chats = null; this.running = new Map(); this.key = null; this.at = 0; this.busy = false;
  }

  // Loads only while the tab is on screen (it reads a lot).
  shown() {
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    return panel && !panel.hidden && body?.active === "chats";
  }

  load(cx) {
    if (this.busy) return;
    this.busy = true;
    this.key = spaceCwd();
    const cwd = this.key;
    cx.spawn(async (cx) => {
      try {
        const git = cwd ? await exec("git", ["worktree", "list", "--porcelain"], { cwd }).catch(() => null) : null;
        const roots = git?.code === 0 ? worktrees(git.stdout) : [];
        this.project = roots[0]?.path.split(/[\\/]/).pop() ?? null;
        if (roots.length) {
          const [claude, index, history, files] = await Promise.all([text(`${home()}/.claude/history.jsonl`), text(`${home()}/.codex/session_index.jsonl`), text(`${home()}/.codex/history.jsonl`), rollouts().catch(() => [])]);
          const all = [...claudeChats(claude), ...codexChats({ files, index, history })];
          this.chats = await projectChats(all, roots, { exists: (p) => fs.exists(p).catch(() => false), home: home().replace(/\\/g, "/") });
          this.running = await running().catch(() => new Map());
        } else this.chats = [];
      } catch (e) {
        this.chats = []; this.error = String(e?.message ?? e);
      }
      this.busy = false; this.at = Date.now();
      cx.notify();
    });
  }

  // A running conversation is focused; otherwise it resumes in a new tab in its own folder, prompts off.
  open(c, cx) {
    cx.spawn(async () => {
      const live = (await running().catch(() => new Map())).get(c.id);
      if (live) return run("pane.focus", { terminal: live });
      const argv = c.program === "claude" ? ["claude", "--dangerously-skip-permissions", "--resume", c.id] : ["codex", "resume", "--yolo", c.id];
      run("tab.new", { name: c.program === "claude" ? "Claude Code" : "Codex", space: spaces().find((s) => s.active)?.id, folder: c.folder, argv });
    });
  }

  render(cx) {
    const t = theme();
    if (this.shown() && !this.busy && (this.key !== spaceCwd() || Date.now() - this.at > 60000)) this.load(cx);
    // The program table's icon: a one-color glyph (tinted) or a picture, as the sidebar draws agents.
    const ico = (c) => {
      const p = this.programs?.[c.program];
      if (!p?.icon) return div().size(14).flex_none();
      return p.tint ? svg(p.icon).size(14).flex_none().text_color(t.foreground) : image(p.icon).w(14).h(14).flex_none();
    };
    const row = (c) => h_flex().id(`chat-${c.id}`).px(10).py(6).gap(8).items_start().cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.open(c, cx))
      .child(ico(c).mt(2))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).text_color(t.foreground).child(c.title))
        .child(div().truncate().text_size(11).text_color(t.dim).child(c.label)))
      .child(this.running.has(c.id)
        ? div().text_size(11).text_color(t.done).child("● open")
        : div().text_size(11).text_color(t.dim).child(ago(c.at)));
    const empty = (msg) => div().p(14).text_size(12).text_color(t.dim).child(msg);
    return v_flex().id("chats").size_full().min_h(0).bg(t.chrome)
      .child(h_flex().h(30).flex_none().px(10).items_center().text_size(11).text_color(t.muted)
        .child(div().flex_1().truncate().child(this.project ? `${this.project} · ${this.chats?.length ?? 0} chats` : "Chats"))
        .child(div().id("chats-refresh").size(22).flex().items_center().justify_center().rounded(6).text_color(t.dim).cursor_pointer().tooltip("Refresh")
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.load(cx)).child(icon("refresh-cw", 13))))
      .child(this.chats === null ? empty("Loading…")
        : this.chats.length ? v_flex().id("chats-list").flex_1().min_h(0).overflow_y_scroll().children(this.chats.map(row))
        : empty(this.project ? "No chats to resume in this project." : "This space has no git repo."));
  }
}
