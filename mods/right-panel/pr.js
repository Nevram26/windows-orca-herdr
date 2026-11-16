// Under Better Changes: Push, and Create PR (a small box prefilled from the branch's commits, then `gh pr create`).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, exec, openOverlay, closeOverlay, props, shared, setShared, layout } from "herdr";
import { spaceCwd, icon, find } from "./chats.js";
import { pushArgs, commitsOf, prDraft, prCreateArgs } from "./data.js";

const git = (cwd, args, timeout) => exec("git", args, { cwd, timeout }).catch(() => ({ code: -1, stdout: "", stderr: "" }));
const out = (r) => `${r.stdout}\n${r.stderr}`.split("\n").map((l) => l.trim()).filter(Boolean);

// The branch's state: name, upstream, unpushed commits, the default branch.
async function status(cwd) {
  const head = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head.code !== 0) return null;
  const branch = head.stdout.trim();
  const up = await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const ahead = up.code === 0 ? Number((await git(cwd, ["rev-list", "--count", "@{u}..HEAD"])).stdout) || 0 : 0;
  let base = (await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).stdout.trim().replace(/^origin\//, "");
  // ponytail: no origin/HEAD (never fetched with it): main, else master. Fine for the usual repos.
  if (!base) base = (await git(cwd, ["rev-parse", "--verify", "-q", "origin/main"])).code === 0 ? "main" : "master";
  return { branch, upstream: up.code === 0, ahead, base };
}

// `git push` on the current branch. Resolves { ok, text }.
async function push(cwd, s) {
  const r = await git(cwd, pushArgs(s.branch, s.upstream), 120000);
  return { ok: r.code === 0, text: r.code === 0 ? "Pushed" : out(r).filter((l) => !l.startsWith("hint:")).slice(-1)[0] ?? "Push failed" };
}

export class PrBar {
  init() {
    this.s = null; this.pr = null; this.msg = null; this.busy = false; this.key = null; this.at = 0; this.ghAt = 0; this.loading = false;
  }

  shown() {
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    return panel && !panel.hidden && body?.active === "changes";
  }

  refresh(cx, force = false) {
    if (this.loading) return;
    this.loading = true;
    const cwd = (this.key = spaceCwd());
    cx.spawn(async (cx) => {
      this.s = cwd ? await status(cwd) : null;
      // A PR is looked up on GitHub: not on every pass.
      if (this.s && (force || Date.now() - this.ghAt > 30000) && this.s.branch !== this.s.base && this.s.upstream) {
        const r = await exec("gh", ["pr", "list", "--head", this.s.branch, "--state", "open", "--json", "url,number", "--limit", "1"], { cwd, timeout: 20000 }).catch(() => null);
        try { this.pr = r?.code === 0 ? JSON.parse(r.stdout)[0] ?? null : null; } catch { this.pr = null; }
        this.ghAt = Date.now();
      } else if (!this.s || this.s.branch === this.s.base || !this.s.upstream) this.pr = null;
      this.loading = false; this.at = Date.now();
      cx.notify();
    });
  }

  // Push; then, for Create PR, the box with the commits so far as its draft.
  act(cx, createPr) {
    if (this.busy || !this.s) return;
    const cwd = this.key, s = this.s;
    this.busy = true; this.msg = { text: "Pushing…", at: Date.now() };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await push(cwd, s);
      this.msg = { ...r, at: Date.now() };
      if (r.ok && createPr) {
        const log = await git(cwd, ["log", "--reverse", "--format=%s%x1f%b%x1e", `origin/${s.base}..HEAD`]);
        const commits = commitsOf(log.stdout);
        openOverlay({ mod: "right-panel", kind: "dialog", width: 440, height: 400, props: { view: "pr-box", cwd, branch: s.branch, base: s.base, count: commits.length, ...prDraft(commits) } });
      }
      this.busy = false;
      this.refresh(cx, true);
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    if (this.shown() && !this.loading && (this.key !== spaceCwd() || Date.now() - this.at > 8000)) this.refresh(cx);
    const s = this.s, made = shared("right-panel.pr");
    const pr = this.pr ?? (made && made.cwd === this.key && made.branch === s?.branch ? made : null);
    const note = this.msg && Date.now() - this.msg.at < 8000 ? this.msg : null;
    const onDefault = s && s.branch === s.base;
    const btn = (id, label, ic, on, act) => h_flex().id(id).h(26).px(9).gap(5).flex_none().items_center().rounded(6).border(1).border_color(t.border).text_size(12)
      .text_color(on ? t.foreground : t.dim).opacity(on ? 1 : 0.5)
      .when(on, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => act(cx)))
      .child(icon(ic, 13)).child(label);
    return h_flex().id("pr-bar").size_full().px(10).gap(6).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(note
        ? div().flex_1().min_w(0).truncate().text_size(11).text_color(note.ok === false ? t.blocked : t.done).tooltip(note.text).child(note.text)
        : div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(s ? `${s.branch}${s.ahead ? ` · ↑${s.ahead}` : ""}` : "No repo"))
      .child(btn("pr-push", "Push", "arrow-up-from-line", Boolean(s) && !this.busy, (cx) => this.act(cx, false)))
      .child(pr
        ? btn("pr-open", `PR #${pr.number ?? ""}`.trim(), "git-pull-request-arrow", true, (cx) => cx.open_url(pr.url))
        : btn("pr-create", "Create PR", "git-pull-request-arrow", Boolean(s) && !onDefault && !this.busy, (cx) => this.act(cx, true)));
  }
}

// The Create PR box (an overlay): title and description, then `gh pr create`.
export class PrBox {
  init() {
    const p = props();
    this.title = InputState.new({ placeholder: "Title", value: p.title ?? "" });
    this.body = TextareaState.new({ placeholder: "Description", value: p.body ?? "" });
    this.body.set_auto_grow(6, 10);
    this.title.focus();
    this.state = null; // null | "busy" | { url } | { error }
  }

  create(cx) {
    const p = props(), title = this.title.value().trim();
    if (!title || this.state === "busy") return;
    this.state = "busy";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("gh", prCreateArgs({ title, body: this.body.value(), base: p.base, branch: p.branch }), { cwd: p.cwd, timeout: 60000 }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
      const url = /https?:\/\/\S+/.exec(r.stdout)?.[0];
      if (r.code === 0 && url) {
        this.state = { url };
        setShared("right-panel.pr", { cwd: p.cwd, branch: p.branch, url, number: /\/(\d+)$/.exec(url)?.[1] });
      } else this.state = { error: out(r).slice(-2).join(" ") || "gh pr create failed" };
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = props(), done = () => closeOverlay(p.overlay), st = this.state;
    const field = (child) => h_flex().px(10).py(6).rounded(6).border(1).border_color(t.border).bg(t.input).child(child);
    const button = (id, label, primary, act) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(primary ? t.solid : t.input).text_size(12)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => act(cx)).child(label);
    return v_flex().id("pr-box").size_full().p(18).gap(10).bg(t.popover).text_size(13)
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Create pull request"))
      .child(div().text_size(11).text_color(t.dim).child(`${p.branch} → ${p.base} · ${p.count} commit${p.count === 1 ? "" : "s"}`))
      .child(field(Input.new(this.title).flex_1().text_size(13).text_color(t.foreground)))
      .child(field(Textarea.new(this.body).flex_1().text_size(12).text_color(t.foreground)))
      .when(st?.url, (el) => el.child(div().id("pr-url").truncate().text_size(12).text_color(t.done).cursor_pointer().on_click((_e, cx) => cx.open_url(st.url)).child(`Created: ${st.url}`)))
      .when(st?.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child(st.error)))
      .child(h_flex().mt_auto().gap(8).justify_end()
        .child(button("pr-cancel", st?.url ? "Close" : "Cancel", false, done))
        .when(!st?.url, (el) => el.child(button("pr-go", st === "busy" ? "Creating…" : "Create PR", true, (cx) => this.create(cx)))));
  }
}
