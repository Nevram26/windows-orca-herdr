// A file in its own tab, opened by panel.js with props { role: "viewer", file (absolute), on }.
// Markdown/text edit in this tab; local images preview here and PDFs open in an installed app.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input } from "gpui-base";
import { props, readTextFile, writeTextFile, watchFolder, theme, settings, focused, spaces, window, shared, setShared } from "herdr";
import { openFile } from "./tabs.js";
import { syntaxColors, languageFor } from "./syntax.js";
import { openExternal, moveToTrash, replaceFile } from "./operations.js";
import { prepareImage, releaseImage } from "./image-preview.js";

const LIMIT = 400000;
const isMarkdown = path => /\.(md|markdown|mdx)$/i.test(path ?? "");
const mediaKind = path => /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(path ?? "") ? "image" : /\.pdf$/i.test(path ?? "") ? "pdf" : "text";
const windows = on => !on && window()?.platform === "windows";
const dirname = (path, on) => path.slice(0, windows(on) ? Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) : path.lastIndexOf("/")) || "/";
const drive = /^[A-Za-z]:[\\/]/; // a Windows absolute path

// A relative or absolute link, resolved against the current file's folder.
function resolve(file, href, on) {
  let p;
  try { p = decodeURIComponent(href.split("#")[0]); } catch { return null; }
  if (!p) return null;
  const parts = [];
  const full = p.startsWith("/") || (windows(on) && drive.test(p)) ? p : `${dirname(file, on)}/${p}`;
  for (const s of (windows(on) ? full.replace(/\\/g, "/") : full).split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop(); else parts.push(s);
  }
  return windows(on) && drive.test(full) ? parts.join("/") : "/" + parts.join("/");
}

// A plain class: main.js (the View) owns it and forwards init, render and close.
export default class Viewer {
  init(_props, cx) {
    const p = props() ?? {};
    this.on = p.on ?? null;
    this.file = p.file; this.source = !this.on;
    this.replaceSource = InputState.new({ placeholder: "Edited file path on this computer" });
    if (!this.file) { this.error = "No file to show"; return; }
    this.load(cx);
    this.watch(cx);
  }

  load(cx) {
    if (this.closed || this.deleted) return;
    const file = this.file;
    const request = this.imageRequest = (this.imageRequest ?? 0) + 1;
    cx.spawn(async cx => {
      try {
        const kind = mediaKind(file);
        if (kind !== "text") {
          if (this.closed || this.file !== file) return;
          this.code?.release(); this.code = null; this.text = null; this.editing = false; this.dirty = false; this.saving = false;
          this.kind = kind; this.truncated = false; this.error = this.on ? "Media preview and actions are available only for local files" : null;
          if (kind === "image" && !this.on) {
            const preview = await prepareImage(file);
            if (this.closed || this.deleted || this.file !== file || request !== this.imageRequest) { await releaseImage(preview); return; }
            const previous = this.preview; this.preview = preview;
            await releaseImage(previous);
          }
          return;
        }
        const raw = await readTextFile(file, { on: this.on });
        if (this.closed || this.file !== file) return;
        const unavailable = raw === null || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw);
        const unavailableMessage = raw === null ? "This file is no longer available" : "Binary file · no text preview";
        if (unavailable && (this.dirty || this.saving)) {
          this.error = `${unavailableMessage}; your draft is retained`; this.reloadPending = true; this.storeDraft(); return;
        }
        const drafts = shared("files-open-with.drafts") ?? {}, draft = drafts[this.draftKey(file)];
        if (unavailable && !draft) {
          this.storeDraft(); this.code?.release(); this.code = null; this.text = null; this.editing = false; this.dirty = false; this.truncated = false;
          this.error = unavailableMessage; return;
        }
        if (this.dirty || this.saving) { this.reloadPending = true; return; }
        const truncated = !unavailable && raw.length > LIMIT;
        const text = unavailable ? "" : truncated ? raw.slice(0, LIMIT) + "\n… (file truncated)" : raw;
        const value = draft ? draft.text : text;
        if (this.code && value === this.text && this.expected === (draft?.expected ?? raw)) return;
        const syntax = await syntaxColors();
        if (this.closed || this.file !== file) return;
        if (this.dirty || this.saving) { this.reloadPending = true; return; }
        this.code?.release();
        this.kind = "text"; this.text = value; this.expected = draft?.expected ?? raw; this.truncated = truncated;
        this.dirty = Boolean(draft && value !== draft.expected); this.editing = !this.on && !truncated; this.source ??= !this.on; this.syntax = syntax;
        this.saveBlocked = Boolean(draft && (unavailable || draft.expected !== raw));
        this.error = unavailable ? `${unavailableMessage}; your draft is retained` : draft && draft.expected !== raw ? "The file changed on disk; your draft is retained and saving will report a conflict" : null;
        this.code = EditorState.new({ language: languageFor(file), readonly: !this.editing, value,
          font_family: settings().font_family, font_size: 12,
          syntax });
        if (this.editing) { this.bindEditor(cx); if (this.dirty) this.scheduleSave(cx); }
      } catch { if (!this.closed && this.file === file && request === this.imageRequest) {
        this.storeDraft();
        if (!this.dirty && !this.editing && !this.saving) { this.code?.release(); this.code = null; this.text = null; }
        this.error = "Cannot preview this file (binary, too large, or unreadable)";
      } }
      finally { if (!this.closed) cx.notify(); }
    });
  }

  draftKey(file = this.file) { return `${this.on ?? ""}|${file}`; }

  storeDraft(text = this.code?.value()) {
    const drafts = { ...(shared("files-open-with.drafts") ?? {}) };
    if (this.dirty && text != null) drafts[this.draftKey()] = { text, expected: this.expected };
    else delete drafts[this.draftKey()];
    setShared("files-open-with.drafts", drafts);
  }

  bindEditor(cx) {
    this.code?.on("change", (_event, cx) => {
      this.text = this.code?.value();
      this.dirty = this.code?.value() !== this.expected;
      this.confirmReload = false;
      if (!this.saveBlocked) this.error = null;
      this.storeDraft();
      this.scheduleSave(cx);
      cx.notify();
    });
  }

  scheduleSave(cx) {
    this.autoSaveTask?.cancel(); this.autoSaveTask = null;
    if (!this.dirty || this.on || this.truncated || this.saving || this.saveBlocked || this.closed || this.closing) return;
    this.autoSaveTask = cx.timer.after(600, cx => { this.autoSaveTask = null; return this.save(cx); });
  }

  save(cx) {
    if (this.savePromise) return this.savePromise;
    if (!this.dirty || !this.code || this.saving || this.on || this.truncated || this.closed || this.deleted) return Promise.resolve();
    this.autoSaveTask?.cancel(); this.autoSaveTask = null;
    this.savePromise = this.write(cx).finally(() => { this.savePromise = null; });
    return this.savePromise;
  }

  async write(cx) {
    const file = this.file, expected = this.expected, draft = this.code.value();
    this.saving = true; this.error = null; cx.notify();
    try {
      await writeTextFile(file, draft, expected);
      if (this.closed || this.file !== file) return;
      this.expected = draft;
      const current = this.code?.value();
      this.text = current ?? draft; this.dirty = current !== draft; this.editing = true; this.saveBlocked = false;
      this.storeDraft(current ?? draft); this.error = null;
    } catch (error) {
      if (this.closed || this.file !== file) return;
      this.saveBlocked = true; this.error = `Auto-save paused: ${String(error?.message ?? error)}`; this.storeDraft(this.code?.value() ?? draft);
    }
    finally {
      if (this.closed || this.file !== file) return;
      this.saving = false; if (this.reloadPending) { this.reloadPending = false; this.load(cx); }
      this.scheduleSave(cx); cx.notify();
    }
  }

  cancelEdit(cx) {
    if (this.saving || this.closed) return;
    this.autoSaveTask?.cancel(); this.autoSaveTask = null; this.saveBlocked = false; this.confirmReload = false;
    this.dirty = false; this.editing = false; this.storeDraft("");
    this.error = null; this.load(cx);
  }

  async openMedia(cx) {
    try { await openExternal(this.file, this.on); this.error = null; }
    catch (error) { this.error = String(error?.message ?? error); }
    cx.notify();
  }

  async deleteFile(cx) {
    if (this.saving || this.closed || this.deleted) return;
    if (this.on || !this.confirmDelete) { this.confirmDelete = true; this.confirmDeleteFile = this.file; return cx.notify(); }
    if (this.file !== this.confirmDeleteFile) { this.confirmDelete = false; this.error = "File changed; confirm deletion again"; return cx.notify(); }
    const file = this.file;
    this.confirmDelete = false;
    this.saving = true; cx.notify();
    try {
      await moveToTrash(file, this.on); if (this.closed || this.file !== file) return;
      this.deleted = true; this.kind = null; this.imageRequest++; this.code?.release(); this.code = null;
      this.error = windows(this.on) ? "Moved to Recycle Bin" : "Moved to Trash"; this.dirty = false; this.editing = false; this.storeDraft("");
      const preview = this.preview; this.preview = null; await releaseImage(preview);
    }
    catch (error) { if (!this.closed && this.file === file) this.error = String(error?.message ?? error); }
    finally { if (!this.closed && this.file === file) { this.saving = false; cx.notify(); } }
  }

  async replaceMedia(cx) {
    if (this.on || this.saving || this.closed) return;
    if (!this.confirmReplace) { this.confirmReplace = true; this.confirmReplaceFile = this.file; return cx.notify(); }
    const source = this.replaceSource.value().trim(), file = this.file;
    if (!source) { this.error = "Enter the edited file path"; return cx.notify(); }
    if (file !== this.confirmReplaceFile) { this.confirmReplace = false; this.error = "File changed; confirm replacement again"; return cx.notify(); }
    this.confirmReplace = false; this.saving = true; this.error = null; cx.notify();
    try { await replaceFile(source, file, this.on); if (this.closed || this.file !== file) return; this.replaceSource.set_value(""); this.load(cx); }
    catch (error) { if (!this.closed && this.file === file) this.error = String(error?.message ?? error); }
    finally { if (!this.closed && this.file === file) { this.saving = false; cx.notify(); } }
  }

  // Local files reload when saved elsewhere; watchFolder only works on this machine.
  watch(cx) {
    if (this.on) return;
    const dir = dirname(this.file, this.on);
    if (this.watching === dir) return;
    this.watching = dir;
    cx.spawn(async cx => {
      try {
        while (!this.closed && this.watching === dir) {
          const changed = await watchFolder(dir);
          if (this.closed || this.watching !== dir) return;
          const slash = p => windows(this.on) ? p.replace(/\\/g, "/") : p, file = slash(this.file);
          if (changed.map(slash).some(c => c.endsWith(file) || file.startsWith(c + "/"))) this.load(cx);
        }
      } catch { if (this.watching === dir) this.watching = null; }
    });
  }

  // Linked files open in their own tab, like clicks in the Files panel.
  followLink(url, cx) {
    if (/^(https?|mailto):/i.test(url)) return cx.open_url(url);
    const next = resolve(this.file, url, this.on);
    if (!next || next === this.file) return;
    this.storeDraft();
    const space = focused()?.space ?? spaces().find(s => s.active)?.id;
    openFile({ file: next, on: this.on, space }, cx);
  }

  body(t) {
    if (this.kind === "image" && !this.on) return this.preview
      ? v_flex().flex_1().min_h(0).p(12).child(image(this.preview.path).size_full())
      : div().p(16).text_color(t.dim).child(this.error || "Loading image…");
    if (this.kind === "pdf" && !this.on) return v_flex().flex_1().items_center().justify_center().gap(8).child(div().text_color(t.dim).child("PDF files open in your installed PDF app."));
    if (!this.code) return div().p(16).text_color(t.dim).child(this.error || "Loading file…");
    if (!isMarkdown(this.file) || this.source) return Editor.new(this.code).flex_1().min_h(0);
    return v_flex().id(`fow-md-${this.file}`).flex_1().min_h(0).overflow_y_scrollbar().px(24).py(16)
      .child(TextView.markdown(`fow-md-view-${this.file}`, this.text).selectable(true).scrollable(false).w_full()
        .text_size(14).text_color(t.foreground).on_link_click((url, cx) => this.followLink(url, cx)));
  }

  button(id, label, t, action) {
    return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(12).text_color(t.muted)
      .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => action(cx)).child(label);
  }

  render(_cx) {
    const t = theme();
    return v_flex().id("fow-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.file ?? ""))
        .when(!this.on && Boolean(this.code) && !this.truncated, el => el.child(div().text_size(11).text_color(t.dim).child(this.saveBlocked ? "Save paused" : this.saving ? "Saving…" : this.dirty ? "Unsaved" : "Saved")))
        .when(this.saveBlocked && !this.on && Boolean(this.code) && !this.saving, el => el
          .child(this.button("fow-retry", "Retry", t, cx => { this.saveBlocked = false; if (this.dirty) return this.save(cx); this.error = null; this.load(cx); }))
          .child(this.button("fow-reload", this.confirmReload ? "Confirm discard" : "Reload disk", t, cx => { if (this.confirmReload) this.cancelEdit(cx); else { this.confirmReload = true; cx.notify(); } })))
        .when(!this.on && (this.kind === "image" || this.kind === "pdf"), el => el.child(this.button("fow-open-media", this.kind === "pdf" ? "Open PDF" : "Open in app", t, cx => this.openMedia(cx))))
        .when(!this.on && (this.kind === "image" || this.kind === "pdf"), el => el.child(this.button("fow-replace", this.confirmReplace ? "Confirm replace" : "Replace…", t, cx => this.replaceMedia(cx))))
        .when(!this.on && this.confirmReplace, el => el.child(this.button("fow-replace-cancel", "Cancel", t, cx => { this.confirmReplace = false; this.replaceSource.set_value(""); this.error = null; cx.notify(); })))
        .when(!this.on && Boolean(this.file) && !this.deleted, el => el.child(this.button("fow-delete", this.confirmDelete ? "Confirm delete" : "Delete…", t, cx => this.deleteFile(cx))))
        .when(!this.on && this.confirmDelete, el => el.child(this.button("fow-delete-cancel", "Cancel", t, cx => { this.confirmDelete = false; this.error = null; cx.notify(); })))
        .when(isMarkdown(this.file) && Boolean(this.code), el => el.child(this.button("fow-mode", this.source ? "Preview" : "Source", t,
          cx => { this.source = !this.source; cx.notify(); }))))
      .when(this.confirmReplace && !this.on, el => el.child(div().px(10).py(5).child(Input.new(this.replaceSource).flex_1())))
      .when(Boolean(this.error), el => el.child(div().px(10).py(4).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(this.body(t));
  }

  close(cx) {
    return this.closePromise ??= (async () => {
      this.closing = true; this.autoSaveTask?.cancel(); this.autoSaveTask = null;
      if (this.savePromise) await this.savePromise;
      if (this.dirty && !this.saveBlocked && !this.on && !this.deleted) await this.save(cx);
      this.storeDraft(); this.closed = true;
      this.code?.release(); this.code = null;
      this.replaceSource?.release(); this.replaceSource = null;
      const preview = this.preview; this.preview = null;
      await releaseImage(preview);
    })();
  }
}
