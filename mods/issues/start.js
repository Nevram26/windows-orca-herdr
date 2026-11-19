// Start (or open) a worktree for an issue or PR. Used by the issues table and the viewer:
// an open space for it is selected, otherwise the Create worktree dialog (new-worktree) opens
// with it picked, so the branch and space name can be checked before creating.
import { spaces, panes, window, run, openOverlay, closeOverlay } from "herdr";

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

const sameFolder = (a, b, machine) => machine == null && window().platform === "windows"
  ? a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase()
  : a === b;

function repoAt(folder, machine, repos) {
  const matches = Object.entries(repos ?? {}).flatMap(([key, repo]) => {
    try {
      const [cwd, on] = JSON.parse(key);
      return (on ?? null) === (machine ?? null) && sameFolder(cwd, folder, machine) ? [repo] : [];
    } catch { return []; }
  });
  return new Set(matches).size === 1 ? matches[0] : null;
}

// A usable checkout for a repository, preferring the current machine when known.
export function checkoutFor(repo, repos, machine, folder) {
  const checkouts = Object.entries(repos ?? {}).flatMap(([key, value]) => {
    try {
      const [folder, on] = JSON.parse(key);
      return value === repo ? [{ repo, folder, machine: on ?? null }] : [];
    } catch { return []; }
  });
  if (folder && repoAt(folder, machine, repos) === repo) return { repo, folder, machine: machine ?? null };
  const preferred = machine === undefined ? [] : checkouts.filter((c) => c.machine === (machine ?? null));
  const candidates = preferred.length ? preferred : checkouts;
  const machines = new Set(candidates.map((c) => c.machine));
  return machines.size === 1 ? candidates[0] ?? { repo, machine: undefined, folder: null } : { repo, machine: undefined, folder: null };
}

// Branch names are only meaningful after the checkout has been verified by repo and machine.
export function spaceFor(item, pr, context) {
  if (!item || !context?.repo || context.machine === undefined || !context.folder ||
      repoAt(context.folder, context.machine, context.repos) !== context.repo) return undefined;
  const issue = new RegExp(`(?:^|/)(?:issue-)?${item.number}(?:$|-)`);
  const allSpaces = spaces(), paneList = panes();
  return allSpaces.find((s) => {
    if (!s.branch || (s.machine ?? null) !== (context.machine ?? null)) return false;
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    const folders = [s.folder, ...paneList.filter((p) => tabs.has(p.tab)).map((p) => p.cwd)].filter(Boolean);
    if (!folders.some((folder) => repoAt(folder, context.machine, context.repos) === context.repo)) return false;
    return pr ? s.branch === item.headRefName : issue.test(s.branch);
  });
}

// folder: a checkout of the repo on `machine`, so the dialog knows the project.
export async function startWorkspace({ repo, machine, folder, repos, item, pr, overlay }) {
  if (!repo || machine === undefined || !folder || repoAt(folder, machine, repos) !== repo) return;
  const existing = spaceFor(item, pr, { repo, machine, folder, repos });
  if (overlay) closeOverlay(overlay);
  if (existing) return run("space.select", { id: existing.id });
  openOverlay({ mod: "new-worktree", kind: "dialog", width: 560, height: 780, props: {
    folder, machine, mode: pr ? "pr" : "issue",
    pick: { kind: pr ? "pr" : "issue", number: item.number, title: item.title, head: item.headRefName },
  } });
}
