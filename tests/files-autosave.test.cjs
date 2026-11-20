const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../mods/files-open-with/viewer.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace("export default class", "class");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function setup({ on = null, text = "disk", drafts = {}, gate = null } = {}) {
  const state = { disk: text, drafts, writes: [], active: 0, maxActive: 0, timers: [], jobs: [], labels: [] };
  const ui = () => { const el = new Proxy({}, { get: (_, key) => (...args) => { if (key === "when" && args[0]) args[1](el); if (key === "child" && typeof args[0] === "string") state.labels.push(args[0]); return el; } }); return el; };
  class Editor {
    constructor(options) { this.options = options; this.text = options.value; this.handlers = {}; }
    value() { return this.text; }
    on(event, handler) { this.handlers[event] = handler; }
    change(text) { this.text = text; this.handlers.change?.({}, cx); }
    release() { this.released = true; }
  }
  const cx = { notify() {}, spawn(fn) { state.jobs.push(fn(cx)); }, timer: { after(ms, callback) {
    const timer = { ms, callback, cancelled: false, cancel() { this.cancelled = true; } }; state.timers.push(timer); return timer;
  } } };
  const env = { div: ui, v_flex: ui, h_flex: ui, image: ui, Editor: { new: ui }, EditorState: { new: options => new Editor(options) }, TextView: { markdown: ui },
    settings: () => ({}), theme: () => ({}), window: () => ({ platform: "windows" }), syntaxColors: async () => ({}), languageFor: () => "markdown",
    shared: () => state.drafts, setShared: (_, value) => { state.drafts = value; }, readTextFile: async () => state.disk,
    releaseImage: async () => {}, writeTextFile: async (file, value, expected) => {
      state.writes.push([file, value, expected]); state.active++; state.maxActive = Math.max(state.maxActive, state.active);
      try { if (gate && state.writes.length === 1) await gate.promise; if (state.disk !== expected) throw new Error("stale file conflict"); state.disk = value; }
      finally { state.active--; }
    } };
  const Viewer = new Function("env", `with (env) { ${source}; return Viewer; }`)(env);
  const view = new Viewer(); Object.assign(view, { file: "C:/notes.md", on }); view.load(cx); await Promise.all(state.jobs);
  const tick = async () => { const timers = state.timers.splice(0); for (const timer of timers) if (!timer.cancelled) await timer.callback(cx); };
  return { view, cx, state, tick };
}

test("local text and Markdown open editable without Edit or Save buttons", async () => {
  const h = await setup(); assert.equal(h.view.code.options.readonly, false); assert.equal(h.view.source, true);
  h.view.render(h.cx); assert.ok(!h.state.labels.includes("Edit")); assert.ok(!h.state.labels.includes("Save")); assert.ok(!h.state.labels.includes("Cancel"));
});

test("typing debounces autosave and preserves the active editor after saving", async () => {
  const h = await setup(), editor = h.view.code;
  editor.change("first"); editor.change("latest"); assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.timers.filter(t => !t.cancelled).length, 1); await h.tick();
  assert.deepEqual(h.state.writes, [["C:/notes.md", "latest", "disk"]]);
  assert.equal(h.view.code, editor); assert.equal(editor.options.readonly, false); assert.equal(h.view.dirty, false);
  editor.change("again"); await h.tick(); assert.equal(h.state.disk, "again");
});

test("changes during autosave are serialized against the last saved snapshot", async () => {
  const gate = deferred(), h = await setup({ gate }); h.view.code.change("first"); const writing = h.tick();
  h.view.code.change("newer"); gate.resolve(); await writing; assert.equal(h.view.dirty, true);
  await h.tick(); assert.equal(h.state.disk, "newer"); assert.equal(h.state.maxActive, 1);
  assert.deepEqual(h.state.writes.map(w => w.slice(1)), [["first", "disk"], ["newer", "first"]]);
});

test("closing flushes pending typing before the editor is released", async () => {
  const h = await setup(), editor = h.view.code; editor.change("closing"); await h.view.close(h.cx);
  assert.equal(h.state.disk, "closing"); assert.equal(editor.released, true); await h.tick(); assert.equal(h.state.writes.length, 1);
});

test("closing shares an in-flight write and flushes its newer draft", async () => {
  const gate = deferred(), h = await setup({ gate }); h.view.code.change("first"); const writing = h.tick();
  const editor = h.view.code; editor.change("latest"); const closing = h.view.close(h.cx);
  assert.ok(!editor.released); gate.resolve(); await writing; await closing;
  assert.equal(h.state.disk, "latest"); assert.equal(h.state.maxActive, 1); assert.equal(h.state.writes.length, 2);
});

test("a save conflict preserves the latest draft and pauses automatic retries", async () => {
  const h = await setup(); h.view.code.change("mine"); h.state.disk = "external"; await h.tick();
  assert.equal(h.state.disk, "external"); assert.match(h.view.error, /conflict/); assert.equal(h.state.drafts["|C:/notes.md"].text, "mine");
  h.view.code.change("newer mine"); await h.tick(); assert.equal(h.state.writes.length, 1); assert.match(h.view.error, /conflict/);
  await h.view.close(h.cx); assert.equal(h.state.drafts["|C:/notes.md"].text, "newer mine");
});

test("clean editable tabs reload external changes", async () => {
  const h = await setup(); h.state.disk = "external"; h.view.load(h.cx); await Promise.all(h.state.jobs);
  assert.equal(h.view.code.value(), "external"); assert.equal(h.view.code.options.readonly, false);
});

test("remote and truncated files remain read-only", async () => {
  for (const options of [{ on: "vps" }, { text: "x".repeat(400001) }]) {
    const h = await setup(options); assert.equal(h.view.code.options.readonly, true);
    h.view.code.change("attempt"); await h.tick(); assert.equal(h.state.writes.length, 0);
  }
});

test("a recovered draft against a changed disk file does not autosave", async () => {
  const h = await setup({ text: "external", drafts: { "|C:/notes.md": { text: "recovered", expected: "old" } } });
  assert.equal(h.view.code.value(), "recovered"); assert.equal(h.view.code.options.readonly, false);
  await h.tick(); assert.equal(h.state.writes.length, 0); assert.match(h.view.error, /changed on disk/);
});
