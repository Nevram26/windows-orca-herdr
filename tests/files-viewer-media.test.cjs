const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../mods/files-open-with/viewer.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace("export default class", "class");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(overrides = {}) {
  const images = [], styles = [], removed = [], jobs = [];
  const ui = () => { const node = new Proxy({}, { get: (_, key) => (...args) => { if (key === "when" && args[0]) args[1](node); styles.push(key); return node; } }); return node; };
  class State {
    constructor(text) { this.text = text; }
    value() { return this.text; }
    release() { this.released = true; }
    on() {}
  }
  const env = { div: ui, v_flex: ui, h_flex: ui, image: p => { images.push(p); return ui(); }, EditorState: { new: o => new State(o.value) },
    settings: () => ({}), window: () => ({ platform: "windows" }), languageFor: () => "text", syntaxColors: async () => ({}),
    shared: () => ({}), setShared() {}, readTextFile: async () => { throw new Error("Media must not be read as text"); },
    prepareImage: async () => ({ path: "mods/files-open-with/.cache/test.png", absolute: "C:/Herdr/test.png" }), releaseImage: async p => { if (p) removed.push(p); },
    ...overrides };
  const Viewer = new Function("env", `with (env) { ${source}; return Viewer; }`)(env);
  const view = new Viewer(); Object.assign(view, { file: "D:/workspace/image.png", on: null });
  const cx = { spawn: fn => jobs.push(fn(cx)), notify() {} };
  return { view, cx, env, images, styles, removed, State, settle: () => Promise.all(jobs) };
}

(async () => {
  const image = setup(); image.view.load(image.cx); await image.settle();
  assert.equal(image.view.preview?.path, "mods/files-open-with/.cache/test.png", "images use an app-relative preview copy");
  image.view.body({});
  assert.deepEqual(image.images, ["mods/files-open-with/.cache/test.png"]);
  assert.ok(image.styles.includes("size_full"), "native image receives nonzero viewport dimensions");
  await image.view.close(); assert.equal(image.removed.length, 1, "close removes the disposable copy");

  const pending = deferred(), late = setup({ prepareImage: () => pending.promise });
  late.view.load(late.cx); await late.view.close();
  const latePreview = { path: "late.png", absolute: "C:/Herdr/late.png" }; pending.resolve(latePreview); await late.settle();
  assert.equal(late.view.preview, null); assert.deepEqual(late.removed, [latePreview]);

  const first = deferred(); let count = 0;
  const newest = { path: "new.png", absolute: "C:/Herdr/new.png" }, oldest = { path: "old.png", absolute: "C:/Herdr/old.png" };
  const reload = setup({ prepareImage: () => ++count === 1 ? first.promise : Promise.resolve(newest) });
  reload.view.load(reload.cx); reload.view.load(reload.cx); await Promise.resolve(); first.resolve(oldest); await reload.settle();
  assert.equal(reload.view.preview, newest); assert.ok(reload.removed.includes(oldest), "late loads cannot replace a newer image");

  const missing = setup({ readTextFile: async () => null });
  const draft = new missing.State("unsaved"); Object.assign(missing.view, { file: "C:/gone.txt", code: draft, expected: "disk", dirty: true, editing: true });
  missing.view.load(missing.cx); await missing.settle();
  assert.equal(missing.view.code, draft, "external deletion retains the active draft");
  assert.equal(draft.released, undefined); assert.match(missing.view.error, /no longer available/);

  const recovery = setup({ readTextFile: async () => null, shared: () => ({ "|C:/gone.txt": { text: "recovered", expected: "old disk" } }) });
  recovery.view.file = "C:/gone.txt"; recovery.view.load(recovery.cx); await recovery.settle();
  assert.equal(recovery.view.code.value(), "recovered", "a missing disk file does not hide a saved draft");
  assert.equal(recovery.view.expected, "old disk"); assert.equal(recovery.view.dirty, true);
  console.log("viewer media and missing-file recovery tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
