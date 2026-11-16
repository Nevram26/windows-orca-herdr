// The right panel's chrome: a tab strip on top of the panel (Files, Changes, Chats, Draw), the icon rail the minimized
// panel becomes, the Chats list and the Push / Create PR bar. A layout puts one copy per block; props.view picks the part.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, layout, shared, window, keys } from "herdr";
import { Chats, icon, find } from "./chats.js";
import { PrBar, PrBox } from "./pr.js";


const TABS = [["files", "Files", "folder"], ["changes", "Changes", "git-compare"], ["chats", "Chats", "messages-square"]];
// Files, Changes, Chats open the panel on that tab.
const open = (id) => { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); };
const draw = () => run("mod.open", { name: "excalidraw" });

// The drawing key as bound here (this layout's section first).
function drawingTip() {
  const mac = window()?.platform === "macos";
  const names = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
  const all = keys().filter((k) => k.action === "mod.open:excalidraw");
  const b = all.find((k) => k.section === `layout:${shared("layout")}`) ?? all.find((k) => k.section === "global");
  return b ? `Open a drawing (${b.keys.split("-").map((p) => names[p] ?? p.toUpperCase()).join("")})` : "Open a drawing";
}

class Tabs {
  render() {
    const t = theme(), active = find(layout(), "panel-body")?.active;
    const tab = (id, label, ic, on, act, tip) => h_flex().id(`tab-${id}`).flex_1().h(26).gap(5).items_center().justify_center().rounded(6).text_size(12)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(on ? t.selected : t.hover))
      .tooltip(tip ?? label).on_click(act).child(icon(ic, 14)).child(label);
    return h_flex().id("panel-tabs").size_full().px(6).gap(2).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .children(TABS.map(([id, label, ic]) => tab(id, label, ic, active === id, () => open(id))))
      .child(tab("draw", "Draw", "pencil-line", false, draw, drawingTip()));
  }
}

// What the minimized panel leaves: Files, Changes, Chats and Excalidraw under the show-panel and actions blocks above.
class Rail {
  render() {
    const t = theme();
    const button = (id, label, ic, act) => div().id(`rail-${id}`).size(28).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).cursor_pointer()
      .tooltip(label).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(act).child(icon(ic, 16));
    return v_flex().id("rail").size_full().pt(8).gap(4).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .children(TABS.map(([id, label, ic]) => button(id, label, ic, () => open(id))))
      .child(button("draw", "Excalidraw", "pencil-line", draw).tooltip(drawingTip()));
  }
}

const PARTS = { tabs: Tabs, rail: Rail, chats: Chats, pr: PrBar, "pr-box": PrBox };

export default class RightPanel extends View {
  init(given, cx) {
    this.part = new (PARTS[props()?.view] ?? Tabs)();
    this.part.init?.(given, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
