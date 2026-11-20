const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../mods/files-open-with/image-preview.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const calls = [];
let copyError;
const { prepareImage, releaseImage } = new Function("mkdir", "unlink", "appHome", "importFile", source + "\nreturn { prepareImage, releaseImage };")(
  async (...args) => calls.push(["mkdir", ...args]),
  async file => calls.push(["unlink", file]),
  () => "C:/Herdr",
  async (...args) => { calls.push(["copy", ...args]); if (copyError) throw copyError; },
);

(async () => {
  await assert.rejects(prepareImage("/remote/picture.png", "vps"), /local/);
  assert.equal(calls.length, 0, "remote images never reach local file operations");
  const preview = await prepareImage("D:/Images/it's a picture.PNG");
  assert.match(preview.path, /^mods\/files-open-with\/\.cache\/[a-z0-9-]+\.png$/);
  assert.equal(preview.absolute, `C:/Herdr/${preview.path}`);
  assert.deepEqual(calls[0], ["mkdir", "C:/Herdr/mods/files-open-with/.cache", { recursive: true }]);
  assert.deepEqual(calls[1], ["copy", "D:/Images/it's a picture.PNG", preview.absolute]);
  const second = await prepareImage("D:/Images/it's a picture.PNG");
  assert.notEqual(second.path, preview.path, "each reload has a fresh native image cache key");
  await releaseImage(preview);
  assert.deepEqual(calls.at(-1), ["unlink", preview.absolute]);
  copyError = new Error("Cannot read image");
  await assert.rejects(prepareImage("D:/Images/missing.png"), /Cannot read image/);
  assert.equal(calls.at(-1)[0], "unlink", "a failed copy removes only its temporary preview");
  assert.notEqual(calls.at(-1)[1], "D:/Images/missing.png");
  console.log("image preview cache tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
