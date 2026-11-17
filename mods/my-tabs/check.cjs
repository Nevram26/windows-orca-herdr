// node mods/my-tabs/check.cjs: tab bar controls and sidebar/panel visibility.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const node = { items: [], handlers: {}, style: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key.startsWith("on_")) node.handlers[key] = args.at(-1);
      else if (key === "id") node.key = args[0];
      else node.style[key] = args[0];
      return proxy;
    };
  } });
  return proxy;
}
const find = (node, id) => !node || typeof node !== "object" ? null : node.key === id ? node : node.items.map(c => find(c, id)).find(Boolean) ?? null;

const state = {}, calls = [];
let sidebar, windowBlock, panelNode, railNode, actionsNode, panelToggleNode;
let viewProps = {}, windowInfo = { platform: "macos" };
let bindings = [];
const env = {
  View: class {}, div: element, h_flex: element, svg: element, image: element,
  theme: () => new Proxy({}, { get: () => "#000" }), settings: () => ({ zoom: 1 }), window: () => windowInfo, props: () => viewProps,
  layout: () => ({ id: "root", children: [sidebar, ...(windowBlock ? [windowBlock] : []), ...(panelNode ? [panelNode, railNode, actionsNode, panelToggleNode] : [])] }), shared: (k) => state[k],
  run: (name, args) => calls.push([name, args == null ? args : JSON.parse(JSON.stringify(args))]), spaces: () => [], panes: () => [], focused: () => null,
  openOverlay() {}, exec() {}, nextCommand: () => new Promise(() => {}),
  keys: () => bindings,
  localStorage: { getItem: () => null, setItem() {} },
};
const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace("export default class", "globalThis.Mod = class");
const context = vm.createContext(env);
vm.runInContext(source, context);
const tabs = new context.Mod();
tabs.init({}, { spawn() {} });

// The tab bar has no duplicate of the brand header's left-sidebar button.
sidebar = { id: "sidebar", size: { px: 268 } };
assert.equal(find(tabs.render(), "sidebar-toggle"), null);
assert.deepEqual(calls, []);

// Hidden: the tab-bar button returns so the left sidebar can be reopened.
calls.length = 0;
sidebar = { id: "sidebar", hidden: true, size: { px: 268 } };
const sidebarButton = find(tabs.render(), "sidebar-toggle");
assert.ok(sidebarButton, "hidden left sidebar exposes its reopen button");
assert.equal(sidebarButton.style.tooltip, "Show sidebar");
assert.deepEqual(calls, [], "hidden is left alone");
sidebarButton.handlers.on_click();
assert.deepEqual(calls, [["layout.toggle", { id: "sidebar" }]]);
calls.length = 0;

// Herdr's brand button made a rail: hidden instead, back at the width it saved.
state["sidebar.width"] = 300;
sidebar = { id: "sidebar", size: { px: 76 } };
tabs.render();
assert.deepEqual(calls, [["layout.resize", { id: "sidebar", px: 300 }], ["layout.hide", { id: "sidebar" }]]);

// An old saved rail with no width to go back to: the layout's default.
calls.length = 0;
delete state["sidebar.width"];
tabs.render();
assert.equal(calls[0][1].px, 268);

// The normal Windows copy reveals the last block and owns the close-command loop.
calls.length = 0;
sidebar = { id: "sidebar", size: { px: 268 } };
windowBlock = { id: "window-buttons", hidden: true };
windowInfo = { platform: "windows", buttons: true };
let listeners = 0;
new context.Mod().init({}, { spawn() { listeners++; } });
assert.equal(listeners, 1);
assert.deepEqual(calls, [["layout.show", { id: "window-buttons" }]]);

// The window-only copy neither takes close commands nor renders tabs/sidebar controls.
calls.length = 0;
viewProps = { part: "window" };
const controls = new context.Mod();
controls.init({}, { spawn() { listeners++; } });
assert.equal(listeners, 1);
assert.deepEqual(calls, []);
const bar = controls.render();
assert.equal(find(bar, "sidebar-toggle"), null);
assert.equal(find(bar, "tab-new"), null);
for (const [id, command] of [["minimize", "window.minimize"], ["maximize", "window.maximize"], ["close-window", "window.close"]]) {
  find(bar, id).handlers.on_click();
  assert.deepEqual(calls.pop(), [command, undefined]);
}

// Files, Changes and Excalidraw moved to the right panel's tab strip and rail.
const barNow = tabs.render();
for (const id of ["panel-files", "panel-changes", "excalidraw"]) assert.equal(find(barNow, id), null);

// The panel button stays in the bar; only Add action moves to the rail when minimized.
calls.length = 0;
viewProps = {};
panelNode = { id: "panel", hidden: false, children: [] }; railNode = { id: "rail" }; actionsNode = { id: "actions", hidden: true };
panelToggleNode = { id: "panel-toggle", hidden: true };
tabs.render();
assert.deepEqual(calls.map(c => `${c[0]} ${JSON.stringify(c[1])}`).sort(), ['layout.hide {"id":"rail"}', 'layout.show {"id":"actions"}', 'layout.show {"id":"panel-toggle"}'].sort());
calls.length = 0;
panelNode = { id: "panel", hidden: true, children: [] }; railNode = { id: "rail", hidden: true }; actionsNode = { id: "actions" };
panelToggleNode = { id: "panel-toggle" };
tabs.render();
assert.deepEqual(calls.map(c => `${c[0]} ${JSON.stringify(c[1])}`).sort(), ['layout.hide {"id":"actions"}', 'layout.show {"id":"rail"}'].sort());
calls.length = 0;
railNode = { id: "rail" }; actionsNode = { id: "actions", hidden: true };
tabs.render();
assert.deepEqual(calls, [], "already in step: nothing to do");

// A saved collapsed layout may still have the top toggle hidden from the old behavior.
panelToggleNode.hidden = true;
tabs.render();
assert.deepEqual(calls, [["layout.show", { id: "panel-toggle" }]]);

// The shipped layout exposes the top toggle immediately and has no duplicate in the rail.
const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "../../layouts/orca.json"), "utf8"));
const nodes = (node) => [node, ...(node.children ?? []).flatMap(nodes)];
assert.equal(nodes(shipped).find(n => n.id === "tabs-row").children.find(n => n.id === "panel-toggle").hidden ?? false, false);
assert.equal(nodes(shipped).some(n => n.id === "rail-toggle"), false);

console.log("my-tabs: ok");
