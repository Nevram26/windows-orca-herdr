// node mods/files-open-with/check.mjs: which right-click items show where, and on Windows,
// the real copy-to-clipboard and Recycle Bin commands on a file named with a space and a quote.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let os = "windows";
globalThis.herdr = { window: () => ({ platform: os }), exec: async () => ({ code: 0, stdout: "Visual Studio Code\nPreview\n" }) };
const src = readFileSync(new URL("./items.js", import.meta.url), "utf8")
  .replace(/^import .* from "herdr";$/m, "const { exec, window } = globalThis.herdr;");
const { ITEMS, available, argvOf } = await import(`data:text/javascript,${encodeURIComponent(src)}`);
const labels = async t => (await available(t)).map(i => ITEMS[i].label);
const agent = { terminal: "t1", name: "Claude Code" };

assert.deepEqual(await labels({ path: "C:\\x\\a.txt", dir: false, on: null, agent }),
  ["Add to agent", "Open with default app", "Show in File Explorer", "Copy path", "Move to Recycle Bin"]);
assert.deepEqual(await labels({ path: "C:\\x", dir: true, on: null, agent: null }),
  ["Show in File Explorer", "Copy path", "Move to Recycle Bin"], "folders: no default app; no agent, no Add to");
assert.deepEqual(await labels({ path: "/srv/a.txt", dir: false, on: "vps", agent }), ["Copy path"], "another machine: copy its path only");
os = "macos";
assert.deepEqual(await labels({ path: "/x/a.txt", dir: false, on: null, agent }),
  ["Add to agent", "Open in VS Code", "Open in Preview", "Quick Look", "Open with default app", "Reveal in Finder", "Copy path", "Move to Trash"]);
os = "linux";
assert.deepEqual(await labels({ path: "/x/a.txt", dir: false, on: null, agent }), [], "no menu where nothing was written for it");

if (process.platform === "win32") {
  const item = label => ITEMS.find(it => it.os === "windows" && it.label === label);
  const run = (label, p) => { const [cmd, ...args] = argvOf(item(label), p); return execFileSync(cmd, args, { encoding: "utf8" }); };
  const clip = format => execFileSync("powershell", ["-NoProfile", "-Command", format === "files" ? "(Get-Clipboard -Format FileDropList).FullName" : "Get-Clipboard -Raw"], { encoding: "utf8" }).trim();
  const saved = clip("text");
  try {
    const file = join(mkdtempSync(join(tmpdir(), "fow-")), "it's a file.txt");
    writeFileSync(file, "x");
    run("Add to agent", file);
    assert.equal(clip("files"), file, "the file itself is on the clipboard, as Explorer's Copy puts it");
    run("Copy path", file);
    assert.equal(clip("text"), file);
    run("Move to Recycle Bin", file);
    assert.equal(existsSync(file), false, "moved to the Recycle Bin");
  } finally {
    if (saved) execFileSync("powershell", ["-NoProfile", "-Command", `Set-Clipboard -Value '${saved.replaceAll("'", "''")}'`]);
  }
}
console.log("files-open-with: ok");
