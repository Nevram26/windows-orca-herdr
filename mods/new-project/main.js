// Add a project (cmd-shift-n, and the sidebar's +), after Orca's: open an existing folder, clone
// one of your GitHub repos (or any Git URL), or create an empty one. Clones and new projects go under a default location that's
// asked for once and remembered (shared "projects.location").
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, pickFolder, run, exec, home, shared, setShared } from "herdr";
import { shProgram, unix } from "./sh.js";

const LOCATION = "projects.location";
// Your GitHub repos, shared with the Issues repo picker (same key, same 30 minutes).
const REPOS = "issues.allRepos", REPOS_TTL = 30 * 60 * 1000;
const isUrl = (q) => q.includes("://") || q.startsWith("git@");
// Home as ~, whichever slashes (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (p) => (p && p.replace(/\\/g, "/").startsWith(home().replace(/\\/g, "/")) ? `~${p.slice(home().length)}` : p ?? "");
const expand = (p) => p.replace(/^~(?=$|[\\/])/, home());
const icon = (name, size = 16) => svg(`mods/workspace-chrome/${name}.svg`).size(size).flex_none();
// owner/repo or a GitHub URL (cloned with gh), else any git URL; and the folder it lands in.
function source(text) {
  const t = text.trim().replace(/\/+$/, "");
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(t);
  if (m) return { gh: `${m[1]}/${m[2]}`, name: m[2] };
  return { url: t, name: t.split(/[/:]/).pop()?.replace(/\.git$/, "") ?? "" };
}
const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const ACTIONS = [
  { id: "browse", icon: "folder", title: "Browse folder", hint: "Local project, Git repo, or folder with many repos" },
  { id: "clone", icon: "git-branch", title: "Clone a repository", hint: "One of your GitHub repos, or any Git URL" },
  { id: "create", icon: "folder-plus", title: "Create new project", hint: "Start from an empty folder" },
];

export default class NewProject extends View {
  init(_props, cx) {
    this.step = "start"; this.at = 0; this.error = ""; this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const field = (placeholder, onSubmit) => {
      const s = InputState.new({ placeholder });
      s.on("change", (_e, cx) => { this.error = ""; cx.notify(); });
      s.on("submit", (_e, cx) => onSubmit(cx));
      return s;
    };
    this.url = field("Search your repos, or paste a Git URL", (cx) => this.clone(cx));
    this.name = field("my-project", (cx) => this.create(cx));
    this.location = field("Where projects go, e.g. ~/Projects", (cx) => (this.step === "clone" ? this.clone(cx) : this.create(cx)));
    this.location.set_value(tilde(shared(LOCATION) ?? ""));
    this.fetchRepos(cx);
  }

  // Every repo the gh login can see (owned, collaborator, organisations), newest push first.
  fetchRepos(cx) {
    if (Date.now() - (shared(REPOS)?.at ?? 0) < REPOS_TTL) return;
    this.reposFailed = false;
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["api", "--paginate", "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
        "-q", '.[] | [.full_name, (.private | tostring)] | @tsv']).catch(() => null);
      const list = r?.code === 0 ? r.stdout.split("\n").filter(Boolean).map((l) => { const [repo, priv] = l.split("\t"); return { repo, private: priv === "true" }; }) : [];
      if (list.length) setShared(REPOS, { at: Date.now(), list }); else this.reposFailed = true;
      cx.notify();
    });
  }

  // The repos matching what's typed; all of them when it's empty or one is already picked.
  matches() {
    const q = this.url.value().trim().toLowerCase(), all = shared(REPOS)?.list ?? [];
    if (isUrl(q)) return [];
    return all.some((r) => r.repo.toLowerCase() === q) || !q ? all : all.filter((r) => r.repo.toLowerCase().includes(q));
  }

  close() { closeOverlay(props()?.overlay); }

  go(id, cx) {
    this.error = "";
    if (id === "browse") return this.browse(cx);
    this.step = id;
    (id === "clone" ? this.url : this.name).focus();
    cx.notify();
  }

  browse(cx) {
    cx.spawn(async () => {
      const folder = await pickFolder({ prompt: "Open a project folder" }).catch(() => null);
      if (!folder) return;
      this.close();
      run("space.new", { folder });
    });
  }

  chooseLocation(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Default location for new projects" }).catch(() => null);
      if (folder) { this.location.set_value(tilde(folder)); this.error = ""; }
      cx.notify();
    });
  }

  // The parent folder typed or picked; remembered as the default for next time.
  async parent() {
    const dir = expand(this.location.value().trim());
    if (!dir) throw new Error("Choose a default location for your projects first.");
    const r = await unix("mkdir", ["-p", dir]).catch(() => null);
    if (r?.code !== 0) throw new Error(`Can't use ${tilde(dir)}: ${(r?.stderr ?? "").trim() || "not writable"}`);
    setShared(LOCATION, dir);
    return dir;
  }

  async free(path) {
    const r = await unix("test", ["-e", path]).catch(() => null);
    return r?.code !== 0;
  }

  // The clone runs in the new space's terminal: progress shows, no 30s exec limit,
  // and it ends in a shell inside the repo.
  clone(cx) {
    if (this.busy) return;
    // A search like "track" clones its first match.
    const typed = this.url.value().trim(), first = this.matches()[0];
    const src = source(!typed.includes("/") && !isUrl(typed) && first ? first.repo : typed);
    if (!src.name || (!src.gh && !src.url)) { this.error = "Enter a Git URL or owner/repo."; return cx.notify(); }
    this.busy = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const dir = await this.parent(), dest = `${dir}/${src.name}`;
        if (!(await this.free(dest))) throw new Error(`${tilde(dest)} already exists. Use Browse folder to open it.`);
        // The space opens on the repo's own (empty) folder and clones into it, so its name, Files
        // and Changes are the repo's. `;` keeps a shell there if the clone fails or is re-run.
        const made = await unix("mkdir", [dest]).catch(() => null);
        if (made?.code !== 0) throw new Error(`Can't create ${tilde(dest)}: ${(made?.stderr ?? "").trim()}`);
        const cmd = src.gh ? `gh repo clone ${sh(src.gh)} .` : `git clone ${sh(src.url)} .`;
        this.close();
        // Windows: Git's sh, ending in PowerShell, Herdr's shell there.
        const posix = await shProgram();
        const shell = posix === "sh" ? 'exec "${SHELL:-zsh}" -l' : "exec powershell.exe -NoLogo";
        run("space.new", { folder: dest, argv: [posix, "-c", `${cmd}; ${shell}`] });
      } catch (e) { this.error = String(e?.message ?? e); this.busy = false; cx.notify(); }
    });
  }

  create(cx) {
    if (this.busy) return;
    const name = this.name.value().trim();
    if (!name || /[/\\]/.test(name)) { this.error = "Enter a folder name (no slashes)."; return cx.notify(); }
    this.busy = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const dir = await this.parent(), dest = `${dir}/${name}`;
        if (!(await this.free(dest))) throw new Error(`${tilde(dest)} already exists. Use Browse folder to open it.`);
        const r = await exec(await shProgram(), ["-c", 'mkdir "$1" && git -C "$1" init -q', "sh", dest]);
        if (r.code !== 0) throw new Error((r.stderr || "Couldn't create it").trim());
        this.close();
        run("space.new", { folder: dest });
      } catch (e) { this.error = String(e?.message ?? e); this.busy = false; cx.notify(); }
    });
  }

  key(e, cx) {
    if (this.step !== "start") return;
    if (e.key === "down" || e.key === "up") this.at = (this.at + (e.key === "down" ? 1 : ACTIONS.length - 1)) % ACTIONS.length;
    else if (e.key === "enter") return this.go(ACTIONS[this.at].id, cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- drawing ----

  header(t, title, sub) {
    return h_flex().gap(10).items_center()
      .when(this.step !== "start", (el) => el.child(div().id("np-back").size(26).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.step = "start"; this.error = ""; this.busy = false; this.handle.focus(); cx.notify(); })
        .child(icon("chevron-left", 15))))
      .child(v_flex().gap(3).child(div().text_size(16).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(12.5).text_color(t.muted).child(sub)));
  }

  input(t, id, state) {
    return div().id(id).h(34).px(10).flex().items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).w_full().h_full().text_size(13).text_color(t.foreground));
  }

  label(t, text) { return div().text_size(12).font_medium().text_color(t.muted).child(text); }

  button(t, id, text, onClick, { solid = false, enabled = true } = {}) {
    return h_flex().id(id).h(34).px(14).gap(8).flex_none().items_center().rounded(8).text_size(13).font_medium().border_1()
      .bg(solid ? t.foreground : t.raised).border_color(solid ? t.foreground : t.border).text_color(solid ? t.background : t.foreground)
      .when(!enabled, (el) => el.opacity(0.5))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)))
      .child(text);
  }

  locationField(t) {
    return v_flex().gap(6)
      .child(this.label(t, "Default location"))
      .child(h_flex().gap(8).child(div().flex_1().min_w(0).child(this.input(t, "np-location", this.location)))
        .child(this.button(t, "np-choose", "Choose folder", (cx) => this.chooseLocation(cx))))
      .child(div().text_size(11.5).text_color(t.dim).child("Remembered for next time."));
  }

  start(t) {
    const row = (a, i) => {
      const on = i === this.at;
      return h_flex().id(`np-${a.id}`).px(12).py(10).gap(12).items_center().rounded(9).cursor_pointer().border_1()
        .border_color(on ? t.foreground : t.border).bg(on ? t.selected : t.background)
        .hover((s) => s.bg(t.hover)).on_hover((h, cx) => { if (h && this.at !== i) { this.at = i; cx.notify(); } })
        .on_click((_e, cx) => this.go(a.id, cx))
        .child(div().size(32).flex_none().flex().items_center().justify_center().rounded(8).bg(t.raised).text_color(t.foreground).child(icon(a.icon)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(13.5).font_medium().text_color(t.foreground).child(a.title))
          .child(div().truncate().text_size(12).text_color(t.muted).child(a.hint)))
        .when(on, (el) => el.child(div().px(6).py(1).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child("↵")));
    };
    return v_flex().gap(14)
      .child(this.header(t, "Add a project", "Open one you have, or bring a new one in."))
      .child(row(ACTIONS[0], 0))
      .child(div().text_size(11.5).font_semibold().text_color(t.dim).child("OTHER WAYS TO ADD"))
      .child(v_flex().gap(8).children(ACTIONS.slice(1).map((a, i) => row(a, i + 1))));
  }

  cloneStep(t) {
    const src = source(this.url.value()), q = this.url.value().trim().toLowerCase();
    const repos = this.matches(), loading = !shared(REPOS) && !this.reposFailed;
    const dest = src.name && this.location.value().trim() ? `${this.location.value().trim().replace(/\/+$/, "")}/${src.name}` : "";
    const note = (text) => div().px(8).py(8).text_size(12).text_color(t.dim).child(text);
    return v_flex().gap(14)
      .child(this.header(t, "Clone a repository", "Pick one of your GitHub repos, or paste any Git URL."))
      .child(v_flex().gap(6).child(this.label(t, "Repository")).child(this.input(t, "np-url", this.url))
        .when(!isUrl(q), (el) => el.child(v_flex().id("np-repos").h(196).flex_none().overflow_y_scrollbar().p(4).gap(1)
          .rounded(8).border_1().border_color(t.border).bg(t.background)
          .children(repos.slice(0, 200).map((r) => {
            const picked = r.repo.toLowerCase() === q;
            return h_flex().id(`np-repo-${r.repo}`).h(30).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
              .when(picked, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { this.url.set_value(r.repo); this.error = ""; cx.notify(); })
              .child(icon("git-branch", 13)).child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(r.repo))
              .when(r.private, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("private")))
              .when(picked, (el) => el.child(div().flex_none().text_size(12).text_color(t.accent).child("✓")));
          }))
          .when(loading, (el) => el.child(note("Loading your repositories…")))
          .when(this.reposFailed, (el) => el.child(note("Couldn't list your repos (is gh signed in?). Paste a URL instead.")))
          .when(!loading && !this.reposFailed && !repos.length, (el) => el.child(note("No repos match. Enter owner/repo or a URL to clone anything else."))))))
      .child(this.locationField(t))
      .when(Boolean(dest), (el) => el.child(div().text_size(12).text_color(t.muted).child(`Clones into ${dest}, in a new space.`)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().gap(8)
        .child(this.button(t, "np-cancel", "Cancel", () => this.close()))
        .child(this.button(t, "np-clone", this.busy ? "Cloning…" : "Clone", (cx) => this.clone(cx), { solid: true, enabled: !this.busy })));
  }

  createStep(t) {
    const name = this.name.value().trim(), loc = this.location.value().trim();
    return v_flex().gap(14)
      .child(this.header(t, "Create new project", "An empty folder with a fresh Git repository."))
      .child(v_flex().gap(6).child(this.label(t, "Name")).child(this.input(t, "np-name", this.name)))
      .child(this.locationField(t))
      .when(Boolean(name && loc), (el) => el.child(div().text_size(12).text_color(t.muted).child(`Creates ${loc.replace(/\/+$/, "")}/${name}, in a new space.`)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().gap(8)
        .child(this.button(t, "np-cancel", "Cancel", () => this.close()))
        .child(this.button(t, "np-create", this.busy ? "Creating…" : "Create project", (cx) => this.create(cx), { solid: true, enabled: !this.busy })));
  }

  render() {
    const t = theme();
    return v_flex().id("new-project").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(20).bg(t.popover).text_size(13)
      .child(this.step === "clone" ? this.cloneStep(t) : this.step === "create" ? this.createStep(t) : this.start(t));
  }
}
