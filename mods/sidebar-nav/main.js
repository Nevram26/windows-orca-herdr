// Sidebar nav: Orca-style links above Spaces that open Automations and Issues as popups.
// The popup's size and look live in each mod's mod.json `overlay`; mod.open again closes it.
// It also keeps the issues assigned to you fresh (assigned.js) in a file agents read.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, shared, setShared } from "herdr";
import { EVERY, fetchAssigned, writeAssigned, readAssigned } from "./assigned.js";

const LINKS = [
  ["automations", "Automations", "mods/sidebar-nav/automations.svg"],
  ["issues", "Issues", "mods/sidebar-nav/issues.svg"],
  ["better-config", "Mod settings", "mods/sidebar-nav/settings.svg"],
];

export default class SidebarNav extends View {
  init(_props, cx) {
    this.width = Infinity;
    cx.spawn(async (cx) => {
      // The last list at once (from disk), then GitHub only when it's stale.
      const saved = shared("issues.assigned")?.items ? null : await readAssigned();
      if (saved) setShared("issues.assigned", saved);
      this.refresh(cx);
    });
    cx.timer.every(60000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    const now = shared("issues.assigned") ?? {};
    if (this.busy || Date.now() - (now.at ?? 0) < EVERY) return;
    this.busy = true;
    setShared("issues.assigned", { ...now, loading: true });
    cx.spawn(async () => {
      try {
        const items = await fetchAssigned(), at = Date.now();
        setShared("issues.assigned", { at, items });
        await writeAssigned(items, at);
      } catch (e) {
        // Keeps the last list; `at` moves on so a failure isn't retried every minute.
        setShared("issues.assigned", { ...now, at: Date.now(), loading: false, error: String(e?.message ?? e) });
      } finally { this.busy = false; }
    });
  }

  render(cx) {
    const t = theme(), collapsed = this.width < 160;
    return v_flex().id("sidebar-nav").size_full().px(8).pt(4).gap(1).bg(t.chrome).text_size(13)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .children(LINKS.map(([mod, label, icon]) =>
        h_flex().id(`nav-${mod}`).h(30).flex_none().px(8).gap(10).items_center().rounded(7).cursor_pointer()
          .when(collapsed, (el) => el.justify_center().px(0))
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .role("button").accessibility_label(label).tooltip(label)
          .on_click(() => run("mod.open", { name: mod }))
          .child(svg(icon).size(16).flex_none())
          .when(!collapsed, (el) => el.child(div().flex_1().min_w(0).truncate().child(label)))));
  }
}
