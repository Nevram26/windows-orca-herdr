const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../mods/files-open-with/tabs.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
let tabs = [], panes = [], saved = {};
const calls = [];
const env = { spaces: () => [{ id: "s", tabs }], panes: () => panes, window: () => ({ platform: "windows" }), shared: () => saved, setShared: (_, value) => { saved = value; },
  run: (command, args) => { calls.push([command, args]); if (command === "tab.new") { const id = `tab${tabs.length}`; tabs.push({ id }); panes.push({ tab: id, mod: args.mod }); } } };
const { openFile } = new Function("env", `with (env) { ${source}; return { openFile }; }`)(env);
const cx = { timer: { after() { throw new Error("The synchronous fixture should track its tab immediately"); } } };
openFile({ file: "C:\\Work\\notes.md", space: "s", edit: true }, cx);
assert.equal(calls[0][0], "tab.new"); assert.equal(calls[0][1].mod, "files-open-with");
assert.equal(calls[0][1].name, "notes.md"); assert.equal(calls[0][1].props.role, "viewer"); assert.equal(calls[0][1].props.edit, true);
openFile({ file: "c:/work/notes.md", space: "s" }, cx);
assert.equal(calls.at(-1)[0], "tab.select", "opening the same Windows file reuses its editor tab");
assert.equal(tabs.length, 1);
openFile({ file: "/srv/A\\B.md", on: "vps", space: "s" }, cx);
assert.equal(calls.at(-1)[1].name, "A\\B.md");
openFile({ file: "/srv/a\\B.md", on: "vps", space: "s" }, cx);
assert.equal(tabs.length, 3, "remote POSIX paths preserve case and literal backslashes");
assert.ok(calls.every(([command]) => command === "tab.new" || command === "tab.select"), "file actions only create/select editor tabs");
console.log("file editor tab tests passed");
