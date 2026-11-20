const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Node {
  constructor() {
    this.childNodes = [];
    return new Proxy(this, { get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "on_key_down") return handler => { target.keyHandler = handler; return receiver; };
      return (...args) => receiver;
    } });
  }
  child(value) { this.childNodes.push(value); return this; }
  children(values) { this.childNodes.push(...values); return this; }
  id(value) { this.nodeId = value; return this; }
  when(condition, fn) { if (condition) fn(this); return this; }
}
const builder = () => new Node();
const ui = { div: builder, image: builder, svg: builder };
const components = { v_flex: builder, h_flex: builder, Editor: { new: builder }, TextView: { markdown: builder }, Input: { new: builder }, Textarea: { new: builder } };
class State {
  constructor(value = "") { this.text = value; this.released = false; }
  value() { return this.text; }
  set_value(value) { this.text = value; }
  content() { return { text: this.text }; }
  release() { this.released = true; }
  on(event, handler) { (this.handlers ??= {})[event] = handler; return this; }
  focus() { this.focused = true; }
}
const gpui = {
  ...components,
  EditorState: { new: options => Object.assign(new State(options.value), { options }) },
  InputState: { new: options => Object.assign(new State(), { options }) },
  TextareaState: { new: options => Object.assign(new State(), { options }) },
};
let stored = {};
const state = { location: { cwd: "/old", on: null, space: "s" }, writes: [], creates: [], reads: [], opens: [], commands: [], syntax: async () => ({}), read: async () => "disk" };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function cx() {
  const value = { tasks: [], notifications: 0, timer: { after: () => ({ cancel() {} }) }, spawn(fn) { const task = Promise.resolve().then(() => fn(value)); value.tasks.push(task); return task; }, notify() { value.notifications++; } };
  return value;
}
const herdr = {
  props: () => ({}),
  readTextFile: (...args) => { state.reads.push(args); return state.read(...args); },
  writeTextFile: (...args) => { state.writes.push(args); return state.write(...args); },
  watchFolder: async () => [], theme: () => ({ background: "b", foreground: "f", border: "x", dim: "d", muted: "m", hover: "h", selected: "s", ansi1: "r", ansi2: "g", blocked: "y" }),
  settings: () => ({}), focused: () => ({ cwd: state.location.cwd, pane: null, terminal: "t", space: "s" }),
  spaces: () => [{ active: true, folder: state.location.cwd, machine: state.location.on, id: "s" }], panes: () => [], agents: () => [], window: () => ({ platform: "windows" }),
  shared: key => key === "files-open-with.drafts" ? stored : null, setShared: (key, value) => { if (key === "files-open-with.drafts") stored = value; },
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), openOverlay() {}, run: (command, args) => state.commands.push([command, args]),
};
function loadModule(file, imports, exportName) {
  let source = fs.readFileSync(file, "utf8");
  source = source.replace(/^import .*;\s*$/gm, "").replace(`export default class ${exportName}`, `globalThis.${exportName} = class ${exportName}`);
  const context = { console, globalThis: null, ui, gpui, herdr, state, stored, syntaxColors: () => state.syntax(), languageFor: () => "text", openExternal: async () => {}, moveToTrash: async () => {}, replaceFile: async () => {}, openFile: args => state.opens.push(args), available: async () => [], menuHeight: () => 100, createFile: (...args) => { state.creates.push(args); return state.create(...args); }, importFile: async () => {}, targetPath: (root, folder, name) => `${root}/${folder}/${name}`.replace("//", "/"), validateName: name => name ? null : "Enter a file name", ICONS: { light: { folderNames: {}, fileNames: {}, fileExtensions: {} }, folderNames: {}, fileNames: {}, fileExtensions: {}, folder: "folder", file: "file" } };
  context.globalThis = context;
  vm.runInNewContext(`${imports}\n${source}`, context, { filename: file });
  return context[exportName];
}
const viewerImports = `const { div, image } = ui; const { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input } = gpui; const { props, readTextFile, writeTextFile, watchFolder, theme, settings, focused, spaces, window, shared, setShared } = herdr; const { openFile } = globalThis; const { syntaxColors, languageFor } = globalThis; const { openExternal, moveToTrash, replaceFile } = globalThis;`;
const panelImports = `const { div, svg, image } = ui; const { v_flex, h_flex, Editor, EditorState, Input, InputState, Textarea, TextareaState } = gpui; const { spaces, panes, agents, focused, exec, readTextFile, watchFolder, theme, settings, window, openOverlay, run } = herdr; const { openFile } = globalThis; const { syntaxColors, languageFor } = globalThis; const { available, menuHeight } = globalThis; const { createFile, importFile, targetPath, validateName } = globalThis; const ICONS = globalThis.ICONS;`;
const Viewer = loadModule("mods/files-open-with/viewer.js", viewerImports, "Viewer");
const Panel = loadModule("mods/files-open-with/panel.js", panelImports, "Panel");
const settle = async c => { for (let i = 0; i < 8; i++) await Promise.resolve(); await Promise.all(c.tasks); };
const input = value => Object.assign(new State(value), { content() { return { text: this.text }; } });

(async () => {
  // Edits made while the captured save is in flight stay dirty against that saved snapshot.
  stored = {}; const save = deferred(); state.write = () => save.promise;
  const v = new Viewer(); Object.assign(v, { file: "C:/a.txt", expected: "base", text: "base", editing: true, dirty: true, code: gpui.EditorState.new({ value: "saved" }) });
  v.code.set_value("saved"); v.dirty = true;
  const c = cx(), pendingSave = v.save(c); v.code.set_value("newer"); save.resolve(null); await pendingSave;
  assert.equal(v.expected, "saved"); assert.equal(v.code.value(), "newer"); assert.equal(v.dirty, true); assert.equal(v.editing, true);

  // A conflict retains the latest draft and does not move the expected snapshot.
  state.write = async () => { throw new Error("stale file"); }; v.code.set_value("latest"); v.dirty = true;
  await v.save(cx()); assert.equal(v.expected, "saved"); assert.equal(stored["|C:/a.txt"].text, "latest"); assert.match(v.error, /stale file/);

  // Recovery restores a draft against its original expectation and surfaces the conflict.
  stored = { "|C:/recover.txt": { text: "draft", expected: "old disk" } }; state.read = async () => "new disk"; state.syntax = async () => ({});
  const recover = new Viewer(); Object.assign(recover, { file: "C:/recover.txt", on: null }); const rc = cx(); recover.load(rc); await settle(rc);
  assert.equal(recover.code.value(), "draft"); assert.equal(recover.expected, "old disk"); assert.equal(recover.dirty, true); assert.match(recover.error, /changed on disk/);

  // A read rechecks the edit state after asynchronous syntax loading.
  stored = {}; state.read = async () => "disk"; const syntax = deferred(); state.syntax = () => syntax.promise;
  const reload = new Viewer(); Object.assign(reload, { file: "C:/race.txt", on: null }); const lc = cx(); reload.load(lc); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const existing = gpui.EditorState.new({ value: "typing" }); Object.assign(reload, { code: existing, text: "before", editing: true, dirty: true }); syntax.resolve({}); await settle(lc);
  assert.equal(reload.code, existing); assert.equal(reload.reloadPending, true);

  // Missing content releases the old code buffer; cancel cannot race a save.
  state.read = async () => null; const missing = new Viewer(); const oldCode = gpui.EditorState.new({ value: "old" }); Object.assign(missing, { file: "C:/gone.txt", code: oldCode, on: null }); const mc = cx(); missing.load(mc); await settle(mc);
  assert.equal(oldCode.released, true); assert.equal(missing.code, null); assert.match(missing.error, /no longer available/);
  missing.saving = true; missing.dirty = true; missing.cancelEdit(cx()); assert.equal(missing.dirty, true);

  // The form keeps its original cwd and cannot clear the replacement form after focus changes.
  state.location = { cwd: "/old", on: null, space: "s" }; const create = deferred(); state.create = (...args) => { state.creates.push(args); return create.promise; };
  const panel = new Panel(); Object.assign(panel, { root: "/old", on: null, context: { key: JSON.stringify(state.location), cwd: "/old", on: null }, entries: new Map([ ["", []] ]), folders: new Set(), loading: true });
  const pc = cx(); panel.beginForm("create", "docs", pc); const oldForm = panel.form; oldForm.name.text = "note.md"; oldForm.text.text = "body";
  const submit = panel.submitForm(pc); assert.equal(state.creates.at(-1)[0], "/old/docs/note.md");
  state.location = { cwd: "/new", on: null, space: "s" }; panel.endForm(oldForm); panel.context = { key: JSON.stringify(state.location), cwd: "/new", on: null }; panel.root = "/new"; panel.beginForm("create", "", pc); const newForm = panel.form;
  create.resolve(null); await submit; assert.equal(panel.form, newForm); assert.equal(oldForm.name.released, true); assert.equal(oldForm.source.released, true); assert.equal(oldForm.text.released, true);

  // Full render retains the panel header and mounts the form inside the panel.
  const tree = panel.render(pc); assert.equal(tree.childNodes.length, 2); assert.equal(tree.childNodes[1].nodeId, "files-form");
  panel.endForm(newForm);
  assert.equal(state.opens.length, 0, "a stale create cannot switch the new workspace's editor tab");
  state.create = async () => null;
  panel.beginForm("create", "", pc); panel.form.name.text = "created.md";
  await panel.submitForm(pc);
  assert.equal(state.opens.at(-1)?.file, "/new/created.md", "successful creation opens the file in an editor tab");
  assert.equal(state.opens.at(-1)?.edit, true);
  panel.openForm("import", "docs", pc);
  assert.equal(panel.form, null, "the Files sidebar remains the tree when creating/importing");
  assert.equal(state.commands.at(-1)?.[0], "tab.new");
  assert.equal(state.commands.at(-1)?.[1].props.role, "form");
  assert.equal(state.commands.at(-1)?.[1].props.root, "/new");
  assert.equal(state.commands.at(-1)?.[1].props.folder, "docs");
  const commandCount = state.commands.length;
  panel.folders.add("docs"); panel.entries.set("docs", []);
  panel.openForm("create", "docs", pc);
  assert.equal(state.commands.length, commandCount, "New uses a filename input in the tree, not a form tab");
  assert.ok(panel.creating?.name.focused);
  assert.equal(panel.rows("docs", 1, [], herdr.theme(), true)[0].nodeId, "files-create-name");
  const filename = panel.creating.name; filename.text = "main.py";
  await filename.handlers.submit({}, pc);
  assert.deepEqual(state.creates.at(-1), ["/new/docs/main.py", "", null], "the typed extension determines the empty file's type");
  assert.equal(state.opens.at(-1)?.file, "/new/docs/main.py"); assert.equal(state.opens.at(-1)?.edit, true);
  assert.equal(filename.released, true); assert.equal(panel.creating, null);
  panel.beginCreate("", pc); const cancelledName = panel.creating.name; panel.rows("", 0, [], herdr.theme(), true)[0].keyHandler({ key: "escape" }, { ...pc, stop_propagation() {} });
  assert.equal(cancelledName.released, true); assert.equal(panel.creating, null);
  console.log("files viewer/panel states: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
