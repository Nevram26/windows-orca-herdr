const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");

const source = fs.readFileSync(new URL("../mods/files-open-with/operations.js", `file://${__filename.replaceAll("\\", "/")}`), "utf8")
  .replace(/^import \{ exec, writeTextFile, window \} from "herdr";\s*/m, "const { exec, writeTextFile, window } = globalThis.herdr;\n");
const load = async (platform = "windows") => {
  const calls = [];
  globalThis.herdr = {
    window: () => ({ platform }),
    writeTextFile: async (...args) => { calls.push(["write", ...args]); return null; },
    exec: async (...args) => { calls.push(["exec", ...args]); return { code: 0, stdout: "", stderr: "" }; },
  };
  const mod = await import(`data:text/javascript,${encodeURIComponent(source)}#${platform}`);
  return { ...mod, calls };
};

(async () => {
  const { validateName, targetPath, createFile, saveText, importFile, openExternal, moveToTrash, replaceFile, calls } = await load();
  for (const name of ["notes.md", "résumé one.md", "it's $ draft.txt"]) assert.equal(validateName(name), null, name);
  for (const name of ["", " ", ".", "..", "../escape", "a/b", "a\\b", "bad:name", "CON.txt", "trail."]) assert.ok(validateName(name), name);
  assert.equal(targetPath("C:\\Work", "docs/guides", "note.md", null), "C:\\Work\\docs\\guides\\note.md");
  assert.equal(targetPath("/srv/work", "docs/guides", "note.md", "vps"), "/srv/work/docs/guides/note.md");
  assert.equal(targetPath("/srv/work", "a\\b", "note.md", "vps"), "/srv/work/a\\b/note.md", "tree-sourced POSIX folder names keep literal backslashes");
  assert.throws(() => targetPath("/srv/work", "../outside", "note.md", "vps"), /folder/);
  await createFile("C:\\Work\\note.md", "hello", null);
  assert.deepEqual(calls[0], ["write", "C:\\Work\\note.md", "hello", null]);
  await assert.rejects(createFile("/srv/work/note.md", "hello", "vps"), /local/);
  assert.equal(calls.length, 1, "remote creation never calls local write APIs");
  await saveText("C:\\Work\\note.md", "edited", "exact original", null);
  assert.deepEqual(calls[1], ["write", "C:\\Work\\note.md", "edited", "exact original"]);
  await assert.rejects(saveText("/srv/work/note.md", "edited", "old", "vps"), /local/);
  assert.equal(calls.length, 2, "remote save never calls local write APIs");
  await importFile("C:\\Source\\it's $ file.png", "C:\\Work\\it's $ file.png", null, "windows");
  assert.deepEqual(calls[2], ["exec", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "[IO.File]::Copy('C:\\Source\\it''s $ file.png','C:\\Work\\it''s $ file.png',$false)"]]);
  await assert.rejects(importFile("/srv/a.png", "/srv/b.png", "vps", "windows"), /local/);
  assert.equal(calls.length, 3, "remote import never invokes a local shell");
  await openExternal("C:\\Work\\it's a.pdf", null, "windows");
  assert.equal(calls[3][1], "powershell");
  assert.equal(calls[3][2][3], "Invoke-Item -LiteralPath 'C:\\Work\\it''s a.pdf'");
  await assert.rejects(openExternal("/srv/a.pdf", "vps", "windows"), /local/);
  await moveToTrash("C:\\Work\\it's a.pdf", null, "windows");
  assert.ok(calls[4][2][3].includes("SendToRecycleBin"));
  await replaceFile("C:\\Work\\edited.png", "C:\\Work\\original.png", null, "windows");
  assert.ok(calls[5][2][3].includes("'C:\\Work\\edited.png'"));
  assert.ok(calls[5][2][3].includes("'C:\\Work\\original.png'"));
  await assert.rejects(replaceFile("/srv/a.png", "/srv/b.png", "vps", "windows"), /remote/);
  const mac = await load("macos");
  await mac.importFile("/tmp/source.png", "/tmp/dest.png", null, "macos");
  assert.equal(mac.calls[0][1], "/bin/sh");
  assert.deepEqual(mac.calls[0][2].slice(-2), ["/tmp/source.png", "/tmp/dest.png"]);
  if (process.platform === "win32") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fow import "));
    const sourcePath = path.join(dir, "it's $ source.bin"), destPath = path.join(dir, "it's $ copy.bin");
    const original = Buffer.from([0, 1, 128, 255, 13, 10]);
    fs.writeFileSync(sourcePath, original);
    await importFile(sourcePath, destPath, null, "windows");
    const command = calls.at(-1);
    cp.execFileSync(command[1], command[2], { encoding: "utf8" });
    assert.deepEqual(fs.readFileSync(destPath), original, "import preserves arbitrary bytes");
    assert.throws(() => cp.execFileSync(command[1], command[2], { encoding: "utf8", stdio: "ignore" }), "import refuses existing destinations");
    assert.deepEqual(fs.readFileSync(destPath), original, "import collision preserves destination bytes");
    const editedPath = path.join(dir, "edited.bin"), replacement = path.join(dir, "replace.bin");
    fs.writeFileSync(editedPath, Buffer.from([255, 0, 17])); fs.writeFileSync(replacement, original);
    await replaceFile(editedPath, replacement, null, "windows");
    const replaceCommand = calls.at(-1);
    cp.execFileSync(replaceCommand[1], replaceCommand[2], { encoding: "utf8" });
    assert.deepEqual(fs.readFileSync(replacement), Buffer.from([255, 0, 17]), "replace writes the edited bytes");
    fs.writeFileSync(editedPath, Buffer.from([9, 8, 7]));
    await replaceFile(path.join(dir, "missing source.bin"), replacement, null, "windows");
    const failedReplace = calls.at(-1);
    assert.throws(() => cp.execFileSync(failedReplace[1], failedReplace[2], { encoding: "utf8", stdio: "ignore" }), "missing source fails");
    assert.deepEqual(fs.readFileSync(replacement), Buffer.from([255, 0, 17]), "failed replacement preserves destination bytes");
    fs.mkdirSync(path.join(dir, "destination folder"));
    await replaceFile(editedPath, path.join(dir, "destination folder"), null, "windows");
    const directoryReplace = calls.at(-1);
    assert.throws(() => cp.execFileSync(directoryReplace[1], directoryReplace[2], { encoding: "utf8", stdio: "ignore" }), "replacement refuses directories");
    await moveToTrash(path.join(dir, "destination folder"), null, "windows");
    const directoryDelete = calls.at(-1);
    assert.throws(() => cp.execFileSync(directoryDelete[1], directoryDelete[2], { encoding: "utf8", stdio: "ignore" }), "delete refuses directories");
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("files-management operations: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
