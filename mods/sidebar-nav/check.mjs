// node mods/sidebar-nav/check.mjs: the assigned list's order and the agents' markdown file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.herdr = { exec: async () => ({ code: 0, stdout: "[]" }), appHome: () => "C:\\app" };
const src = readFileSync(new URL("./assigned.js", import.meta.url), "utf8")
  .replace(/^import \* as fs from "fs\/promises";$/m, "const fs = {};")
  .replace(/^import .* from "herdr";$/m, "const { exec, appHome } = globalThis.herdr;");
const { sortAssigned, markdown } = await import(`data:text/javascript,${encodeURIComponent(src)}`);

const issue = (repo, number, labels = [], updatedAt = "2026-11-01T00:00:00Z") =>
  ({ repo, number, title: `Issue ${number}`, url: `https://github.com/${repo}/issues/${number}`, updatedAt, labels: labels.map((name) => ({ name })) });
const list = sortAssigned([
  issue("me/small", 1),
  issue("me/big", 2, ["priority:P2"]),
  issue("me/big", 3, [], "2026-11-09T00:00:00Z"),
  issue("me/big", 4, ["priority:P0"]),
  issue("me/big", 5, [], "2026-11-10T00:00:00Z"),
]);
assert.deepEqual(list.map((i) => i.number), [4, 2, 5, 3, 1], "bigger repo first; P0 before P2 before unlabelled; then newest");

const md = markdown(list, Date.parse("2026-11-16T06:00:00Z"));
assert.match(md, /^# Issues assigned to me on GitHub \(open\)$/m);
assert.match(md, /^## me\/big \(4\)$/m);
assert.match(md, /^- #4 Issue 4 \[priority:P0\] — https:\/\/github\.com\/me\/big\/issues\/4$/m);
assert.match(md, /^- #1 Issue 1 — https:\/\/github\.com\/me\/small\/issues\/1$/m);
assert.match(markdown([], 0), /Nothing is assigned to me\./);
console.log("sidebar-nav: ok");
