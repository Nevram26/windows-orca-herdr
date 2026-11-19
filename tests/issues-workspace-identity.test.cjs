const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const spaces = [];
const calls = [];
let sharedFolders = {};
const context = {
  spaces: () => spaces,
  panes: () => [],
  run: (...args) => calls.push(['run', ...args]),
  openOverlay: (...args) => calls.push(['open', ...args]),
  closeOverlay: (...args) => calls.push(['close', ...args]),
  window: () => ({ platform: 'windows' }),
  shared: () => sharedFolders,
  InputState: { new: () => ({ on() {}, value: () => '' }) },
  TextareaState: { new: () => ({ on() {}, set_auto_grow() {}, value: () => '' }) },
};
vm.createContext(context);
vm.runInContext(read('mods/issues/start.js').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '') +
  '\nthis.spaceFor = spaceFor; this.startWorkspace = startWorkspace; this.checkoutFor = checkoutFor;', context);
context.startWorkspace = context.startWorkspace;
vm.runInContext(read('mods/issues/viewer.js').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '') +
  '\nthis.Viewer = Viewer;', context);

const registry = (entries) => Object.fromEntries(entries.map(([folder, machine, repo]) => [JSON.stringify([folder, machine]), repo]));
const space = (id, folder, machine, branch, tabs = []) => ({ id, folder, machine, branch, tabs });
const item = { number: 12, title: 'Fix login', headRefName: 'fix/login' };
const ctx = (repo, machine, folder, repos) => ({ repo, machine, folder, repos });
const reset = () => { spaces.length = 0; calls.length = 0; };

function matchingSpace(repo, machine, folder, repos, branch = 'dev/feat/12') {
  reset();
  spaces.push(space('wanted', folder, machine, branch));
  return context.spaceFor(item, false, ctx(repo, machine, folder, repos));
}

async function main() {
assert.equal(matchingSpace('acme/a', 'linux-host', '/work/a', registry([
  ['/work/a', 'linux-host', 'acme/a'], ['/work/a-task', 'linux-host', 'acme/a'],
  ['/work/b', 'linux-host', 'acme/b'],
])), spaces[0], 'same repository in another worktree is eligible');

reset();
spaces.push(space('wrong-repo', '/work/b', 'linux-host', 'dev/feat/12'));
spaces.push(space('wrong-machine', '/work/a', 'remote-2', 'dev/feat/12'));
spaces.push(space('wanted', '/work/a-task', 'linux-host', 'dev/feat/12'));
const repoMap = registry([
  ['/work/a', 'linux-host', 'acme/a'], ['/work/a-task', 'linux-host', 'acme/a'],
  ['/work/b', 'linux-host', 'acme/b'], ['/work/a', 'remote-2', 'acme/a'],
]);
assert.equal(context.spaceFor(item, false, ctx('acme/a', 'linux-host', '/work/a', repoMap)), spaces[2]);
assert.equal(context.spaceFor(item, true, ctx('acme/a', 'linux-host', '/work/a', repoMap)), undefined,
  'a shared PR head is still scoped by repository and machine');

reset();
spaces.push(space('wrong-repo-pr', '/work/b', 'linux-host', 'fix/login'));
spaces.push(space('wanted-pr', '/work/a-task', 'linux-host', 'fix/login'));
assert.equal(context.spaceFor(item, true, ctx('acme/a', 'linux-host', '/work/a', repoMap)), spaces[1],
  'a shared PR head matches only the intended repository');

reset();
spaces.push(space('pane-checkout', '/other', 'linux-host', 'dev/feat/12', [{ id: 'terminal' }]));
context.panes = () => [{ tab: 'terminal', terminal: 'pane-terminal', cwd: '/work/a-task', branch: 'dev/feat/12' }];
assert.equal(context.spaceFor(item, false, ctx('acme/a', 'linux-host', '/work/a', repoMap)), spaces[0],
  'a verified pane checkout can identify a space whose main folder differs');
reset();
spaces.push(space('mixed', '/work/a', 'linux-host', 'dev/feat/12', [{ id: 'split' }]));
context.panes = () => [
  { tab: 'split', terminal: 'first', cwd: '/work/b', branch: 'dev/feat/12' },
  { tab: 'split', terminal: 'second', cwd: '/work/a', branch: 'dev/feat/12' },
];
const mixedRepos = registry([['/work/a', 'linux-host', 'acme/a'], ['/work/b', 'linux-host', 'acme/b']]);
assert.equal(context.spaceFor(item, false, ctx('acme/a', 'linux-host', '/work/a', mixedRepos)), undefined,
  'a second pane and stale space folder cannot override the first terminal that supplies branch');
assert.equal(context.spaceFor(item, false, ctx('acme/b', 'linux-host', '/work/b', mixedRepos)), spaces[0]);
context.panes = () => [
  { tab: 'split', terminal: 'first', cwd: null, branch: null },
  { tab: 'split', terminal: 'second', cwd: '/work/a', branch: 'dev/feat/12' },
];
assert.equal(context.spaceFor(item, false, ctx('acme/a', 'linux-host', '/work/a', mixedRepos)), undefined,
  'a pane other than the branch terminal cannot supply identity when its cwd is missing');
context.panes = () => [];
assert.equal(context.spaceFor(item, false, ctx('acme/a', 'linux-host', '/work/a', registry([
  ['/work/a', 'linux-host', 'acme/a'],
])), undefined), spaces[0], 'space.folder is the fallback when there are no live pane cwd values');

reset();
spaces.push(space('unmapped', '/unknown', 'linux-host', 'dev/feat/12'));
assert.equal(context.spaceFor(item, false, ctx('acme/a', 'linux-host', '/unknown', {})), undefined,
  'unknown checkout identity cannot match by branch alone');
assert.equal(context.spaceFor(item, false, ctx(null, 'linux-host', '/work/a', repoMap)), undefined,
  'missing repository identity cannot match');
assert.equal(context.spaceFor(item, false, ctx('acme/a', undefined, '/work/a', repoMap)), undefined,
  'an explicitly undefined machine is unknown, not local');

assert.equal(matchingSpace('acme/a', null, 'c:/work/repo', registry([
  ['C:\\Work\\Repo', null, 'acme/a'],
])), spaces[0], 'local Windows path aliases are equivalent');
assert.equal(matchingSpace('acme/a', 'linux-host', '/srv/Repo', registry([
  ['/srv/repo', 'linux-host', 'acme/a'],
])), undefined, 'remote path case remains significant');
assert.equal(matchingSpace('acme/a', 'linux-host', '/srv/a\\b', registry([
  ['/srv/a/b', 'linux-host', 'acme/a'],
])), undefined, 'remote backslashes remain literal');

reset();
spaces.push(space('local', 'C:\\work\\repo', null, 'dev/feat/12'), space('remote', 'C:\\work\\repo', 'remote', 'dev/feat/12'));
const both = registry([['C:\\work\\repo', null, 'acme/a'], ['C:\\work\\repo', 'remote', 'acme/a']]);
assert.equal(context.spaceFor(item, false, ctx('acme/a', 'remote', 'C:\\work\\repo', both)), spaces[1],
  'null local machine differs from a named remote machine');

async function starts() {
  reset();
  spaces.push(space('wrong', '/work/b', 'linux-host', 'dev/feat/12'));
  await context.startWorkspace({ ...ctx('acme/a', 'linux-host', '/work/a', registry([
    ['/work/a', 'linux-host', 'acme/a'], ['/work/b', 'linux-host', 'acme/b'],
  ])), item, pr: false, overlay: 'viewer' });
  assert.deepEqual(calls.map(([kind]) => kind), ['close', 'open']);
  assert.equal(calls[1][1].props.folder, '/work/a');
  assert.equal(calls[1][1].props.machine, 'linux-host');
  assert.equal(calls[1][1].props.pick.number, 12);

  reset();
  await context.startWorkspace({ ...ctx('acme/a', 'linux-host', '/work/a', registry([
    ['/work/a', 'linux-host', 'acme/a'],
  ])), item, pr: true, overlay: 'viewer' });
  assert.equal(calls[1][1].props.mode, 'pr');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1].props.pick)), {
    kind: 'pr', number: 12, title: 'Fix login', head: 'fix/login',
  });

  reset();
  spaces.push(space('right', '/work/a-task', 'linux-host', 'dev/feat/12'));
  await context.startWorkspace({ ...ctx('acme/a', 'linux-host', '/work/a', registry([
    ['/work/a', 'linux-host', 'acme/a'], ['/work/a-task', 'linux-host', 'acme/a'],
  ])), item, pr: false, overlay: 'viewer' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['close', 'viewer'], ['run', 'space.select', { id: 'right' }]]);

  reset();
  await context.startWorkspace({ ...ctx('acme/a', 'linux-host', '/unknown', {}), item, pr: false, overlay: 'viewer' });
  assert.deepEqual(calls, [], 'invalid identity cannot select, open, or close anything');

  await context.startWorkspace({ ...ctx('acme/a', undefined, 'C:\\work\\repo', registry([
    ['C:\\work\\repo', null, 'acme/a'],
  ])), item, pr: false, overlay: 'viewer' });
  assert.deepEqual(calls, [], 'an undefined machine cannot select the local checkout');
}

function makeViewer({ repo = 'acme/a', number = 1, machine = null, folder = '/a', repos = registry([
  ['/a', null, 'acme/a'], ['/b', null, 'acme/b'], ['/a-remote', 'host', 'acme/a'],
]), on = machine } = {}) {
  const viewer = Object.create(context.Viewer.prototype);
  Object.assign(viewer, { repo, number, machine, folder, on, repos, history: [], issue: item, kinds: {}, overlay: 'viewer', reset() {}, load() {}, isPr() { return false; } });
  return viewer;
}

const viewer = makeViewer();
viewer.go('acme/b', 2, { notify() {} });
assert.equal(viewer.repo, 'acme/b');
assert.equal(viewer.folder, '/b', 'known cross-repository checkout context follows navigation');
viewer.back({ notify() {} });
assert.deepEqual(JSON.parse(JSON.stringify(viewer.history)), []);
assert.equal(viewer.repo, 'acme/a');
assert.equal(viewer.folder, '/a', 'Back restores folder and machine context');

const sameRepo = makeViewer({ repo: 'acme/a', number: 1, machine: 'host', folder: '/a-remote', on: 'host' });
sameRepo.go('acme/a', 2, { notify() {} });
assert.equal(sameRepo.machine, 'host', 'same-repository navigation retains the remote machine');
assert.equal(sameRepo.folder, '/a-remote');
sameRepo.back({ notify() {} });
assert.equal(sameRepo.machine, 'host');

const remote = makeViewer({ repo: 'acme/a', machine: 'host', folder: '/a-remote', on: 'host' });
remote.go('acme/b', 3, { notify() {} });
assert.equal(remote.machine, null, 'a unique local destination checkout switches away from the remote machine');
assert.equal(remote.folder, '/b');
remote.back({ notify() {} });
assert.equal(remote.machine, 'host');
assert.equal(remote.folder, '/a-remote');

reset();
spaces.push(space('public-props-space', 'C:\\Work\\Repo', null, 'dev/feat/12'));
context.panes = () => [];
sharedFolders = registry([['C:\\Other', null, 'acme/other']]);
const viewerJobs = [];
const publicViewer = new context.Viewer({ repo: 'acme/a', number: 12, on: null, folder: 'c:/work/repo', machine: null },
  'viewer', { spawn: (fn) => viewerJobs.push(fn), notify() {} });
assert.equal(publicViewer.repos[JSON.stringify(['c:/work/repo', null])], 'acme/a',
  'Viewer seeds a verified tuple from its existing public props contract');
assert.equal(publicViewer.repos[JSON.stringify(['C:\\Other', null])], 'acme/other',
  'Viewer merges previously discovered shared checkouts');
publicViewer.issue = item;
publicViewer.workspace({ spawn: (fn) => viewerJobs.push(fn), notify() {} });
await viewerJobs.at(-1)();
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
  ['close', 'viewer'], ['run', 'space.select', { id: 'public-props-space' }],
], 'Viewer without a repos prop can still open its verified checkout');

const unknownMachineViewer = new context.Viewer({ repo: 'acme/a', number: 12, on: null, folder: 'C:\\Work\\Repo', machine: undefined },
  'viewer', { spawn() {}, notify() {} });
assert.equal(unknownMachineViewer.machine, undefined, 'unknown Viewer machine is not coerced to local');

const unknown = makeViewer({ repos: registry([['/a', null, 'acme/a']]) });
unknown.go('acme/unknown', 2, { notify() {} });
assert.equal(unknown.folder, null, 'cross-repository identity is cleared when no checkout is known');
unknown.back({ notify() {} });
assert.equal(unknown.repo, 'acme/a');
assert.equal(unknown.folder, '/a', 'Back restores context after an unknown destination');

assert.equal(context.checkoutFor('acme/a', repoMap, 'linux-host', '/work/a-task').folder, '/work/a-task',
  'viewer actions retain the specific verified checkout when several worktrees share a repo');

await starts();
reset();
const pending = [];
const delayed = makeViewer();
delayed.workspace({ spawn: (fn) => pending.push(fn) });
delayed.repo = 'acme/b'; delayed.folder = '/b'; delayed.machine = 'host';
delayed.repos[JSON.stringify(['/a', null])] = 'acme/mutated';
await pending[0]();
assert.equal(calls[1][1].props.folder, '/a', 'async workspace action snapshots its triggering context');
assert.equal(calls[1][1].props.machine, null);

console.log('issue workspace identity tests passed');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
