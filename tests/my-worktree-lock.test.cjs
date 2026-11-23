const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../mods/my-worktree/main.js'), 'utf8');
const lockOf = main.slice(main.indexOf('async function lockOf('), main.indexOf('\nexport default class'));
const list = [
  'worktree C:/repo', 'HEAD 1', 'branch refs/heads/main', '',
  'worktree C:/wt/locked-why', 'HEAD 2', 'branch refs/heads/a', 'locked on a USB drive', '',
  'worktree C:/wt/locked', 'HEAD 3', 'branch refs/heads/b', 'locked', '',
  'worktree C:/wt/free', 'HEAD 4', 'branch refs/heads/c',
].join('\n');
const c = { git: async () => ({ ok: true, out: list }) };
vm.createContext(c);
vm.runInContext(`${lockOf}; this.lockOf = lockOf;`, c);
(async () => {
  assert.equal(await c.lockOf('C:/repo', 'C:/wt/locked-why'), 'on a USB drive');
  assert.equal(await c.lockOf('C:/repo', 'C:/wt/locked'), '');
  assert.equal(await c.lockOf('C:/repo', 'C:/wt/free'), null);
  assert.equal(await c.lockOf('C:/repo', 'C:/wt/lock'), null, 'a prefix of another path is not that worktree');
  c.git = async () => ({ ok: false, out: '' });
  assert.equal(await c.lockOf('C:/repo', 'C:/wt/locked'), null, 'a failed list lets git itself decide');
  console.log('my-worktree lock check passed');
})().catch((e) => { console.error(e); process.exit(1); });
