const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mods/excalidraw/main.js'), 'utf8');

function methods(...names) {
  return names.map(name => {
    const match = source.match(new RegExp(`^  (?:async )?${name}\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}`, 'm'));
    assert.ok(match, `production method ${name} exists`);
    return match[0];
  }).join('\n');
}

function harness(writer, reader = async () => null, maxSpawns = Infinity) {
  const writes = [];
  const files = new Map();
  const notices = [];
  let activeWrites = 0;
  let maxConcurrentWrites = 0;
  const context = {
    serializeDocument: value => JSON.stringify(value),
    parseDocument: text => JSON.parse(text),
    clone: elements => elements.map(element => ({ ...element })),
    basename: file => file.slice(file.lastIndexOf('/') + 1),
    dirname: file => file.slice(0, file.lastIndexOf('/')) || '/',
    notify() {},
    History: class { constructor() { this.undoStack = []; this.redoStack = []; } },
    writeTextFile2: async (...args) => {
      writes.push(args);
      activeWrites++;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      try { return await writer(...args); }
      finally { activeWrites--; }
    },
    readTextFile: reader,
    notify: message => notices.push(message),
    appHome: () => '/app',
    storage: files,
    recoveryFiles: new Map(),
    fs2: {
      mkdir: async () => {},
      readFile: async file => {
        if (context.recoveryRead) return context.recoveryRead(file);
        if (!context.recoveryFiles.has(file)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
        return context.recoveryFiles.get(file);
      },
      unlink: async file => { context.recoveryFiles.delete(file); }
    },
    tt2: () => [0, 0],
    emptyDocument: () => ({ elements: [], appState: {}, files: {}, source: 'test' }),
    __runDueTimers() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, async flush() {} },
    cx: null
  };
  vm.createContext(context);
  vm.runInContext(`class Test { ${methods('save', 'switchFile', 'openFile', 'showPicker', 'choose', 'pickerKey', 'applyExternal', 'map', 'elements', 'load', 'fail', 'close', 'recoveryPath', 'recoverySnapshot', 'writeRecovery', 'clearRecovery', 'restoreRecovery', 'tick')} }; this.Test = Test;`, context);
  const jobs = [];
  let spawnCount = 0;
  const cx = { spawn: callback => {
    if (spawnCount++ < maxSpawns) jobs.push(Promise.resolve().then(() => callback(cx)));
  }, notify() {} };
  const editor = new context.Test();
  const elements = [{ id: 'unsaved' }];
  const scene = {
    getElementsIncludingDeleted: () => elements,
    getNonDeletedElements: () => elements,
    getNonDeletedElementsMap: () => new Map(elements.map(element => [element.id, element])),
    replaceAllElements: next => { elements.splice(0, elements.length, ...next); }
  };
  const history = {
    undoStack: [[{ id: 'before' }]], redoStack: [],
    record(value) { this.undoStack.push(value.map(element => ({ ...element }))); }
  };
  const selection = new Set(['selected']);
  Object.assign(editor, {
    file: '/drawings/current.excalidraw', status: 'ready', dirty: true, saveAt: 1,
    doc: { elements: [{ id: 'persisted' }], appState: {}, files: {}, source: 'test' }, scene, history, selected: selection,
    lastText: 'old disk', saveError: null, revision: 1,
    showPickerCalls: 0, showPicker() { this.showPickerCalls++; },
    endEdit() {}, watch: async () => {}, writeImages: async () => {},
    rebuild() {}, focus: { focus() {} }
  });
  editor.herdrZoom = () => 1;
  editor.builtZ = 1;
  return { editor, cx, jobs, writes, files, notices, context, scene, history, selection, get maxConcurrentWrites() { return maxConcurrentWrites; } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('failed save keeps Open out of the picker and preserves editor state', async () => {
  const failure = new Error('disk unavailable');
  const h = harness(async () => { throw failure; });
  h.editor.switchFile(h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.showPickerCalls, 0);
  assert.equal(h.editor.scene, h.scene);
  assert.equal(h.editor.history, h.history);
  assert.equal(h.editor.selected, h.selection);
  assert.equal(h.editor.dirty, true);
  assert.equal(h.editor.saveError, failure.message);
});

test('unreadable disk after a failed save preserves the scene and reports both errors', async () => {
  const h = harness(async () => { throw new Error('write denied'); }, async () => { throw new Error('read denied'); });
  h.editor.switchFile(h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.showPickerCalls, 0);
  assert.equal(h.editor.scene, h.scene);
  assert.equal(h.editor.history, h.history);
  assert.equal(h.editor.selected, h.selection);
  assert.equal(h.editor.dirty, true);
  assert.match(h.editor.saveError, /write denied.*read denied/);
});

test('Open waits for pending save and never overlaps writes', async () => {
  const write = deferred();
  const h = harness(() => write.promise);
  h.editor.switchFile(h.cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.editor.showPickerCalls, 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.maxConcurrentWrites, 1);
  write.resolve();
  await Promise.all(h.jobs);
  assert.equal(h.editor.showPickerCalls, 1);
});

test('close shares an already pending drawing save instead of starting a duplicate', async () => {
  const write = deferred();
  const files = new Map([['/drawings/current.excalidraw', 'old disk']]);
  const writer = async (file, text, expected) => {
    await write.promise;
    if ((files.get(file) ?? null) !== expected) throw new Error('stale snapshot');
    files.set(file, text);
  };
  const h = harness(writer, async file => files.get(file) ?? null);
  h.context.storage = files;
  h.context.recoveryFiles = files;
  const save = h.editor.save(h.cx);
  await new Promise(resolve => setImmediate(resolve));
  const close = h.editor.close(h.cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.writes.filter(([file]) => file.endsWith('.excalidraw')).length, 1);
  write.resolve();
  await Promise.all([save, close]);
  assert.equal(h.writes.filter(([file]) => file.endsWith('.excalidraw')).length, 1);
});

test('edits made during a save block navigation after the older write completes', async () => {
  const write = deferred();
  const h = harness(() => write.promise);
  h.editor.switchFile(h.cx);
  await new Promise(resolve => setImmediate(resolve));
  h.editor.revision++;
  h.editor.dirty = true;
  write.resolve();
  await Promise.all(h.jobs);
  assert.equal(h.editor.showPickerCalls, 0);
  assert.equal(h.editor.dirty, true);
});

test('a successful save allows one picker transition', async () => {
  const h = harness(async () => {});
  h.editor.switchFile(h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.showPickerCalls, 1);
  assert.equal(h.editor.dirty, false);
  assert.equal(h.writes.length, 1);
});

test('a disk conflict retains undo recovery and blocks the picker transition', async () => {
  const recoveryFiles = new Map();
  const h = harness(async (file, text, expected) => {
    if (file.includes('/recovery/')) {
      if ((recoveryFiles.get(file) ?? null) !== expected) throw new Error('stale recovery');
      recoveryFiles.set(file, text);
    } else throw new Error('stale snapshot');
  }, async () => JSON.stringify({ elements: [{ id: 'external' }] }));
  h.context.recoveryFiles = recoveryFiles;
  h.editor.doc.files = { unsavedImage: { dataURL: 'data:image/png;base64,AA==' } };
  h.editor.switchFile(h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.showPickerCalls, 0);
  assert.equal(h.editor.dirty, false);
  assert.deepEqual(h.history.undoStack.at(-1), [{ id: 'unsaved' }]);
  assert.match(h.editor.saveError, /stale snapshot/);
  const recovery = JSON.parse([...recoveryFiles.values()][0]);
  assert.equal(recovery.document.files.unsavedImage.dataURL, 'data:image/png;base64,AA==');
  const reopened = harness(async () => {}, async () => JSON.stringify({ elements: [{ id: 'external' }] }));
  reopened.context.recoveryFiles = recoveryFiles;
  reopened.editor.status = 'loading';
  reopened.editor.openFile('/drawings/current.excalidraw', reopened.cx);
  await Promise.all(reopened.jobs);
  assert.equal(reopened.editor.doc.files.unsavedImage.dataURL, 'data:image/png;base64,AA==');
});

test('repeated Open remains blocked after conflict moved unsaved work into undo', async () => {
  const recoveryFiles = new Map();
  const external = JSON.stringify({ elements: [{ id: 'external' }] });
  const h = harness(async (file, text, expected) => {
    if (file.includes('/recovery/')) {
      if ((recoveryFiles.get(file) ?? null) !== expected) throw new Error('stale recovery');
      recoveryFiles.set(file, text);
    } else throw new Error('stale snapshot');
  }, async () => external);
  h.context.recoveryFiles = recoveryFiles;
  h.editor.switchFile(h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.showPickerCalls, 0);
  h.editor.switchFile(h.cx);
  await Promise.all(h.jobs.slice(1));
  assert.equal(h.editor.showPickerCalls, 0);
  assert.equal(h.history.undoStack.at(-1)[0].id, 'unsaved');
});

test('direct openFile cannot bypass a persisted conflict undo version', () => {
  const h = harness(async () => {});
  h.editor.dirty = false;
  h.editor.hasUnsavedConflict = true;
  h.editor.openFile('/drawings/next.excalidraw', h.cx);
  assert.equal(h.editor.file, '/drawings/current.excalidraw');
  assert.equal(h.editor.history, h.history);
});

test('picker Escape returns to the existing editor without reloading the file', () => {
  const h = harness(async () => {});
  h.editor.status = 'pick';
  h.editor.picker = {};
  h.editor.pickerKey({ key: 'escape' }, h.cx);
  assert.equal(h.editor.scene, h.scene);
  assert.equal(h.editor.history, h.history);
  assert.equal(h.editor.selected, h.selection);
});

test('direct openFile replacement is gated on a safe save', async () => {
  const h = harness(async () => { throw new Error('disk unavailable'); });
  h.editor.openFile('/drawings/other.excalidraw', h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.file, '/drawings/current.excalidraw');
  assert.equal(h.editor.scene, h.scene);
  assert.equal(h.editor.dirty, true);
});

test('direct openFile of the current path does not reset dirty editor state', () => {
  const h = harness(async () => {});
  h.editor.openFile(h.editor.file, h.cx);
  assert.equal(h.editor.scene, h.scene);
  assert.equal(h.editor.history, h.history);
  assert.equal(h.editor.selected, h.selection);
  assert.equal(h.editor.dirty, true);
});

test('direct openFile of a clean editor transitions to the requested drawing', async () => {
  const h = harness(async () => {}, async () => JSON.stringify({ elements: [] }), 2);
  h.editor.dirty = false;
  h.editor.openFile('/drawings/next.excalidraw', h.cx);
  await h.jobs[0];
  assert.equal(h.editor.file, '/drawings/next.excalidraw');
});

test('direct openFile after a successful dirty save transitions exactly once', async () => {
  const h = harness(async () => {}, async () => JSON.stringify({ elements: [] }), 2);
  h.editor.openFile('/drawings/next.excalidraw', h.cx);
  await h.jobs[0];
  assert.equal(h.editor.file, '/drawings/next.excalidraw');
  assert.equal(h.writes.length, 1);
  assert.equal(h.jobs.length, 2, 'one initial guard and one load, no recursive guard');
});

test('retrying a failed save clears its old error after persistence succeeds', async () => {
  let attempts = 0;
  const h = harness(async () => { if (++attempts === 1) throw new Error('temporary write failure'); });
  assert.equal(await h.editor.save(h.cx), false);
  assert.match(h.editor.saveError, /temporary write failure/);
  assert.equal(await h.editor.save(h.cx), true);
  assert.equal(h.editor.saveError, null);
});

test('failed final save leaves a per-file recovery snapshot that reopen restores', async () => {
  const files = new Map([['/drawings/current.excalidraw', JSON.stringify({ elements: [{ id: 'disk' }] })]]);
  const writer = async (file, text, expected) => {
    if (file.endsWith('.excalidraw')) throw new Error('disk read only');
    if ((files.get(file) ?? null) !== expected) throw new Error('stale recovery');
    files.set(file, text);
  };
  const reader = async file => files.get(file) ?? null;
  const h = harness(writer, reader);
  h.context.storage = files;
  h.context.recoveryFiles = files;
  h.editor.history.undoStack.push([{ id: 'large', payload: 'x'.repeat(1024 * 1024 + 32) }]);
  h.editor.lastText = JSON.stringify({ elements: [{ id: 'disk' }] });
  await h.editor.close(h.cx);
  const recoveryKey = [...files.keys()].find(key => key.includes('/recovery/'));
  assert.ok(recoveryKey, 'failed close persisted per-file recovery');
  const savedText = files.get(recoveryKey);
  assert.ok(savedText.length > 1024 * 1024, 'recovery larger than the text-reader limit was persisted');
  const saved = JSON.parse(savedText);
  assert.equal(saved.file, '/drawings/current.excalidraw');
  assert.deepEqual(saved.document.elements, [{ id: 'unsaved' }]);
  assert.equal(saved.history.undoStack.at(-1)[0].id, 'large');

  const reopened = harness(writer, reader);
  reopened.context.storage = new Map();
  reopened.context.recoveryFiles = files;
  reopened.editor.status = 'loading';
  reopened.editor.openFile('/drawings/current.excalidraw', reopened.cx);
  await Promise.all(reopened.jobs);
  assert.equal(reopened.editor.scene.getElementsIncludingDeleted()[0].id, 'unsaved');
  assert.equal(reopened.editor.history.undoStack.at(-2)[0].id, 'large');
  assert.ok(reopened.editor.history.undoStack.at(-2)[0].payload.length > 1024 * 1024);
  assert.equal(reopened.editor.dirty, true);
  assert.ok(reopened.notices.some(notice => String(notice?.title ?? '').toLowerCase().includes('recovered')), JSON.stringify(reopened.notices));
  assert.equal(files.get('/drawings/current.excalidraw'), JSON.stringify({ elements: [{ id: 'disk' }] }));
});

test('recovery larger than 1 MiB can be restored by another mod copy', async () => {
  const recoveryFiles = new Map();
  const disk = JSON.stringify({ elements: [{ id: 'disk' }] });
  const h = harness(async (file, text, expected) => {
    if (file.endsWith('.excalidraw')) throw new Error('disk read only');
    if ((recoveryFiles.get(file) ?? null) !== expected) throw new Error('stale recovery');
    recoveryFiles.set(file, text);
  }, async () => disk);
  h.context.recoveryFiles = recoveryFiles;
  const payload = 'x'.repeat(1024 * 1024 + 16);
  recoveryFiles.set(h.editor.recoveryPath(), JSON.stringify({
    version: 1, file: h.editor.file, text: 'old unsaved scene',
    document: { elements: [{ id: 'recovered' }], appState: {}, files: {}, source: 'test' },
    history: { undoStack: [[{ id: 'before', payload }]], redoStack: [] }, selected: ['recovered']
  }));
  const reopened = harness(async () => {}, async () => disk);
  reopened.context.storage = new Map();
  reopened.context.recoveryFiles = recoveryFiles;
  reopened.editor.status = 'loading';
  reopened.editor.openFile('/drawings/current.excalidraw', reopened.cx);
  await Promise.all(reopened.jobs);
  assert.ok(reopened.editor.history.undoStack.some(scene => scene[0]?.payload?.length === payload.length));
});

test('restoring recovery after disk changed preserves disk in undo and blocks autosave', async () => {
  const recoveryFiles = new Map();
  const disk = JSON.stringify({ elements: [{ id: 'disk' }] });
  let drawingWrites = 0;
  const h = harness(async (file, text, expected) => {
    if (file.endsWith('.excalidraw')) { drawingWrites++; return; }
    if ((recoveryFiles.get(file) ?? null) !== expected) throw new Error('stale recovery');
    recoveryFiles.set(file, text);
  }, async () => disk);
  h.context.recoveryFiles = recoveryFiles;
  await h.editor.writeRecovery({
    version: 1, file: h.editor.file, text: 'older unsaved scene',
    document: { elements: [{ id: 'recovered' }], appState: {}, files: {}, source: 'test' },
    history: { undoStack: [[{ id: 'before' }]], redoStack: [] }, selected: ['recovered']
  });
  h.editor.status = 'loading';
  h.editor.openFile('/drawings/current.excalidraw', h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.dirty, true);
  h.editor.tick(h.cx);
  await Promise.all(h.jobs.slice(1));
  assert.equal(drawingWrites, 0);
  assert.equal(h.editor.scene.getElementsIncludingDeleted()[0].id, 'recovered');
  assert.equal(h.editor.history.undoStack.at(-1)[0].id, 'disk');
});

test('close with recovery conflict preserves recovery without saving over newer disk', async () => {
  const recoveryFiles = new Map();
  const disk = JSON.stringify({ elements: [{ id: 'newer disk' }] });
  let drawingWrites = 0;
  const h = harness(async (file, text, expected) => {
    if (file.endsWith('.excalidraw')) { drawingWrites++; return; }
    if ((recoveryFiles.get(file) ?? null) !== expected) throw new Error('stale recovery');
    recoveryFiles.set(file, text);
  }, async () => disk);
  h.context.recoveryFiles = recoveryFiles;
  await h.editor.writeRecovery({
    version: 1, file: h.editor.file, text: 'older unsaved scene',
    document: { elements: [{ id: 'recovered' }], appState: {}, files: {}, source: 'test' },
    history: { undoStack: [[{ id: 'before' }]], redoStack: [] }, selected: ['recovered']
  });
  h.editor.status = 'loading';
  h.editor.openFile('/drawings/current.excalidraw', h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.recoveryConflict, true);
  await h.editor.close(h.cx);
  assert.equal(drawingWrites, 0);
  assert.ok([...recoveryFiles.values()].some(text => JSON.parse(text).file === '/drawings/current.excalidraw'));
});

test('malformed recovery leaves the successfully loaded disk scene usable', async () => {
  const h = harness(async () => {}, async () => JSON.stringify({ elements: [{ id: 'disk' }] }));
  h.context.recoveryFiles.set(h.editor.recoveryPath(), JSON.stringify({
    version: 1, file: h.editor.file, text: 'bad', document: null,
    history: { undoStack: 'bad', redoStack: [] }, selected: []
  }));
  h.editor.status = 'loading';
  h.editor.openFile('/drawings/current.excalidraw', h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.status, 'ready');
  assert.equal(h.editor.doc.elements[0].id, 'disk');
  assert.equal(h.editor.scene.getElementsIncludingDeleted()[0].id, 'disk');
  assert.match(h.editor.saveError, /invalid recovery/i);
});

test('successful save removes the corresponding recovery snapshot', async () => {
  const files = new Map([['/drawings/current.excalidraw', 'old disk']]);
  let allowDrawingSave = false;
  const writer = async (file, text, expected) => {
    if (file.endsWith('.excalidraw') && !allowDrawingSave) throw new Error('drawing read only');
    if ((files.get(file) ?? null) !== expected) throw new Error('stale snapshot');
    files.set(file, text);
  };
  const h = harness(writer, async file => files.get(file) ?? null);
  h.context.storage = files;
  h.context.recoveryFiles = files;
  await h.editor.close(h.cx);
  const recovery = [...files.keys()].find(key => key.includes('/recovery/'));
  assert.ok(recovery);
  allowDrawingSave = true;
  await h.editor.save(h.cx);
  assert.equal(files.has(recovery), false);
});

test('recovery persistence failures remain visible on close', async () => {
  const h = harness(async file => { throw new Error(file.includes('/recovery/') ? 'recovery volume unavailable' : 'drawing read only'); }, async () => null);
  await h.editor.close(h.cx);
  assert.match(h.editor.saveError, /recovery volume unavailable/);
});

test('recovery read failure surfaces a useful error while opening the original drawing', async () => {
  const h = harness(async () => {}, async () => JSON.stringify({ elements: [] }));
  h.context.recoveryRead = async () => { throw new Error('recovery read denied'); };
  h.editor.status = 'loading';
  h.editor.openFile('/drawings/current.excalidraw', h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.status, 'ready');
  assert.match(h.editor.saveError, /recovery read denied/);
});

test('missing recovery file is an ordinary open without an error notice', async () => {
  const h = harness(async () => {}, async () => JSON.stringify({ elements: [] }));
  h.editor.status = 'loading';
  h.editor.openFile('/drawings/current.excalidraw', h.cx);
  await Promise.all(h.jobs);
  assert.equal(h.editor.status, 'ready');
  assert.equal(h.editor.saveError, null);
  assert.equal(h.notices.length, 0);
});
