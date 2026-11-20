// Herdr's shipped Files panel (Herdr 0.1.11, Apache-2.0), plus a right-click menu
// that opens, reveals, copies or deletes the clicked file or folder, or hands it to
// this space's agent. See menu.js and items.js.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { spaces, panes, agents, focused, exec, readTextFile, watchFolder, theme, settings, window, openOverlay, run } from "herdr";
import { openFile } from "./tabs.js";
import { syntaxColors, languageFor } from "./syntax.js";
import { available, menuHeight } from "./items.js";
import { createFile, importFile, targetPath, validateName } from "./operations.js";
import ICONS from "./icons.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000;
// Only local Windows paths share case and slash spelling; remote Unix paths stay exact.
const pathKey = (p, on) => (!on && window()?.platform === "windows" ? p.replace(/\\/g, "/").toLowerCase() : p);

// Material icons: icons.js is a copy of file-icons' table; the SVGs stay in that mod.
const ICON_DIR = "mods/file-icons/icons";
const bare = name => name.replace(/^__(.+)__$/, "$1").replace(/^[._-]/, "");
const opened = id => id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`;
function lookup(table, key, dark) { return (dark ? undefined : ICONS.light[table][key]) ?? ICONS[table][key]; }
function icon(path, dir, open, dark) {
  const parts = path.toLowerCase().split("/"), name = parts[parts.length - 1];
  const table = dir ? "folderNames" : "fileNames", find = key => lookup(table, key, dark) ?? (dir ? lookup(table, bare(key), dark) : undefined);
  let id;
  for (let i = 0; !id && i < parts.length - 1; i++) id = find(parts.slice(i).join("/"));
  if (dir) {
    id ??= find(name) ?? ICONS.folder;
    return `${ICON_DIR}/${open ? opened(id) : id}.svg`;
  }
  id ??= lookup(table, name, dark);
  for (let dot = name.indexOf("."); !id && dot !== -1; dot = name.indexOf(".", dot + 1)) id = lookup("fileExtensions", name.slice(dot + 1), dark);
  return `${ICON_DIR}/${id ?? ICONS.file}.svg`;
}

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    const r = await exec("powershell", ["-NoProfile", "-Command", "& { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)); link=[bool]($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -L "$p" ]; then kind=l; elif [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d", link: fields[i] === "l" });
  return out;
}

// A plain class: main.js (the View) owns it and forwards init and render.
export default class Panel {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {}; this.ignored = new Set();
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return !this.closed && this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      this.endCreate();
      this.endForm();
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.ignored = new Set(); this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {}, ignored = new Set();
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal", "--ignored"], { cwd, on }).catch(() => null);
          let count = 0;
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean)) {
            const xy = entry.slice(0, 2), file = `${top.stdout.trim()}/${entry.slice(3)}`;
            // "!!": ignored; a wholly ignored folder comes as one "dir/" entry.
            if (xy === "!!") { ignored.add(pathKey(file.replace(/\/$/, ""), on)); continue; }
            if (count++ >= TOTAL) continue;
            marks[pathKey(file, on)] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.ignored = ignored; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const syntax = await syntaxColors();
        if (this.file !== path || !this.current(context)) return;
        this.code = EditorState.new({ language: languageFor(path), readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // A file opens in its own tab of this space (viewer.js), reused if already open.
  openTab(path, cx) {
    openFile({ file: `${this.root}/${path}`, on: this.on, space: location().space }, cx);
  }

  openForm(kind, folder = "", cx) {
    if (!this.root || this.on) return;
    if (kind === "create") return this.beginCreate(folder, cx);
    const { space } = location();
    run("tab.new", { name: kind === "create" ? "New file" : "Import file", space, mod: "files-open-with",
      props: { role: "form", kind, folder, root: this.root, on: this.on, space } });
  }

  beginCreate(folder, cx) {
    if (!this.root || this.on || this.creating?.busy) return;
    this.endCreate(); this.notice = null;
    if (folder && !this.folders.has(folder)) this.toggle(folder, cx);
    const name = InputState.new({ placeholder: "File name (e.g. notes.md)" });
    const entry = this.creating = { name, folder, context: this.context, space: location().space, busy: false };
    name.on("submit", (_event, cx) => this.submitCreate(cx));
    name.on("change", (_event, cx) => { if (this.creating === entry) { entry.error = null; cx.notify(); } });
    name.focus(); cx.notify();
  }

  endCreate() {
    this.creating?.name.release(); this.creating = null;
  }

  async submitCreate(cx) {
    const entry = this.creating;
    if (!entry || entry.busy) return;
    const { context, folder } = entry, name = entry.name.value();
    if (!this.current(context)) { this.endCreate(); return; }
    const invalid = validateName(name);
    if (invalid) { entry.error = invalid; cx.notify(); return; }
    entry.busy = true; entry.error = null; cx.notify();
    try {
      const file = targetPath(context.cwd, folder, name, context.on);
      await createFile(file, "", context.on);
      if (this.creating === entry && this.current(context)) {
        this.endCreate();
        const children = this.entries.get(folder) ?? [];
        if (!children.some(child => child.name === name)) this.entries.set(folder, [...children, { name, dir: false }].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
        openFile({ file, on: context.on, space: entry.space, edit: true }, cx);
        this.refresh(cx);
      }
    } catch (error) { if (this.creating === entry) entry.error = String(error?.message ?? error); }
    finally { entry.busy = false; if (!this.closed) cx.notify(); }
  }

  beginForm(kind, folder = "", cx) {
    if (!this.root || this.form?.busy) return;
    this.endForm();
    this.notice = null;
    this.form = { kind, folder, root: this.context.cwd, on: this.context.on, space: location().space, context: this.context, key: this.context.key, name: InputState.new({ placeholder: "File name" }), source: InputState.new({ placeholder: "Local source file path" }), text: TextareaState.new({ placeholder: "File contents", rows: 6 }), error: null, busy: false };
    cx.notify();
  }

  endForm(form = this.form) {
    if (!form) return;
    if (this.form === form) this.form = null;
    form.name?.release(); form.source?.release(); form.text?.release();
  }

  async submitForm(cx) {
    const form = this.form;
    if (!form || form.busy) return;
    if (this.context !== form.context || !this.current(form.context)) { this.endForm(form); cx.notify(); return; }
    const { root, on } = form;
    const folder = form.folder, kind = form.kind;
    let name = form.name.content().text.trim();
    const source = form.source.content().text.trim(), text = form.text.content().text;
    if (kind === "import" && !name) name = source.split(/[\\/]/).pop();
    const invalid = validateName(name);
    if (invalid) { form.error = invalid; cx.notify(); return; }
    if (on) { form.error = "File changes are available only on this computer"; cx.notify(); return; }
    form.busy = true; form.error = null; cx.notify();
    try {
      const destination = targetPath(root, folder, name, on);
      if (kind === "create") await createFile(destination, text, on);
      else {
        if (!source) throw new Error("Enter the local source file path");
        await importFile(source, destination, on);
      }
      if (this.form === form && this.context === form.context && this.current(form.context)) {
        this.endForm(form); this.notice = `${name} ${kind === "create" ? "created" : "imported"}`;
        openFile({ file: destination, on, space: form.space, edit: kind === "create" }, cx);
      }
      this.refresh(cx);
    } catch (error) { if (this.form === form) form.error = String(error?.message ?? error); }
    finally { form.busy = false; if (this.form === form) cx.notify(); }
  }

  formView(t) {
    const f = this.form;
    const field = state => div().h(32).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).child(Input.new(state).flex_1().text_color(t.foreground));
    const action = (id, label, fn, primary = false) => div().id(id).h(30).px(10).flex().items_center().rounded(6).cursor_pointer().bg(primary ? t.selected : t.hover).text_color(t.foreground).on_click((_e, cx) => fn(cx)).child(label);
    return v_flex().id("files-form").flex_1().min_h(0).p(12).gap(8)
      .child(div().font_semibold().child(`${f.kind === "create" ? "New file" : "Import file"} in ${f.folder || "workspace root"}`))
      .child(field(f.name))
      .when(f.kind === "import", el => el.child(field(f.source)))
      .when(f.kind === "create", el => el.child(div().flex_1().min_h(80).rounded(6).border_1().border_color(t.border).p(4).child(Textarea.new(f.text).flex_1().text_color(t.foreground))))
      .when(Boolean(f.error), el => el.child(div().text_size(12).text_color(t.ansi1).child(f.error)))
      .when(Boolean(this.notice), el => el.child(div().text_size(12).text_color(t.ansi2).child(this.notice)))
      .child(h_flex().gap(6).justify_end().child(action("files-form-cancel", "Cancel", cx => { if (!f.busy) this.endForm(f); cx.notify(); })).child(action("files-form-submit", f.busy ? "Working…" : (f.kind === "create" ? "Create" : "Import"), cx => this.submitForm(cx), true)));
  }

  // Right-click: which items apply (installed apps only), then the popup at the pointer.
  menu(path, dir, cx) {
    if (!this.on && window()?.platform === "windows") path = path.replace(/\//g, "\\");
    const target = { path, dir, on: this.on, agent: this.agent() };
    cx.spawn(async () => {
      const items = await available(target);
      if (!items.length) return;
      openOverlay({ mod: "files-open-with", kind: "popup", width: 240, height: menuHeight(items.length), props: { role: "menu", ...target, items } });
    });
  }

  // The agent "Add to" pastes into: the focused one in this space, else its first.
  agent() {
    const { space } = location(), here = agents().filter(a => a.space === space);
    const a = here.find(a => a.address === focused()?.terminal) ?? here[0];
    return a ? { terminal: a.address, name: a.program?.name || a.app || "agent" } : null;
  }

  // Ignored by git, itself or through a folder above it.
  isIgnored(path) {
    for (let p = path; p; p = p.slice(0, Math.max(0, p.lastIndexOf("/")))) if (this.ignored.has(pathKey(`${this.root}/${p}`, this.on))) return true;
    return false;
  }

  rows(prefix, depth, out, t, dark) {
    if (out.length >= TOTAL || depth > 40) return out;
    const creating = this.creating;
    if (creating?.folder === prefix) {
      out.push(v_flex().id("files-create-name").flex_none().pl(8 + depth * 18).pr(8)
        .on_key_down((e, cx) => { if (e.key === "escape" && !creating.busy) { cx.stop_propagation(); this.endCreate(); cx.notify(); } })
        .child(h_flex().h(28).gap(7).items_center().child(div().w(12).flex_none())
          .child(image(icon(creating.name.value() || "file", false, false, dark)).size(16).flex_none())
          .child(div().flex_1().min_w(0).h(24).flex().items_center().px(4).border_1().border_color(creating.error ? t.ansi1 : t.ansi4).rounded(3)
            .child(Input.new(creating.name).flex_1().min_w(0).text_color(t.foreground))))
        .when(Boolean(creating.error), el => el.child(div().pl(19).py(4).text_size(11).text_color(t.ansi1).child(creating.error))));
    }
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[pathKey(`${this.root}/${path}`, this.on)];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .drag_paths([`${this.root}/${path}`], { on: this.on })
        .when(this.isIgnored(path), el => el.opacity(0.5))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.openTab(path, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(`${this.root}/${path}`, entry.dir, cx); })
        .child(entry.dir ? svg(`mods/files-open-with/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(image(icon(path, entry.dir, open, dark)).size(16).flex_none())
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(entry.dir && !this.on, el => el.child(div().id(`files-add-${path}`).px(6).text_color(t.muted)
          .when(Boolean(this.root) && !this.form?.busy, button => button.cursor_pointer().hover(s => s.text_color(t.foreground)).on_click((e, cx) => { cx.stop_propagation(); this.openForm("create", path, cx); }))
          .when(!this.root || this.form?.busy, button => button.opacity(0.5)).child("＋")))
        .when(Boolean(entry.link), el => el.child(svg("mods/files-open-with/link.svg").size(12).flex_none().text_color(t.dim)))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t, dark);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), dark = Boolean(settings().dark);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .when(!this.on, el => el.child(h_flex().gap(4)
          .child(div().id("files-new").px(7).py(4).rounded(5).text_size(12)
            .when(Boolean(this.root) && !this.form?.busy, button => button.cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => this.openForm("create", "", cx)))
            .when(!this.root || this.form?.busy, button => button.opacity(0.5)).child("＋ New"))
          .child(div().id("files-import").px(7).py(4).rounded(5).text_size(12)
            .when(Boolean(this.root) && !this.form?.busy, button => button.cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => this.openForm("import", "")))
            .when(!this.root || this.form?.busy, button => button.opacity(0.5)).child("Import"))))
        .child(div().id("files-current").flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); if (this.root) this.menu(this.file ? `${this.root}/${this.file}` : this.root, !this.file, cx); })
          .child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(this.form ? this.formView(t) : v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t, dark))
        .when(Boolean(this.error) || (!this.entries.get("")?.length && !this.creating), el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))
        .when(Boolean(this.notice) && !this.form, el => el.child(div().p(8).text_size(12).text_color(t.ansi2).child(this.notice)))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }

  close() { this.closed = true; this.endCreate(); this.endForm(); this.context = null; }
}
