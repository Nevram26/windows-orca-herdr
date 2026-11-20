// Import uses an editor tab; new filenames are entered directly in the Files tree.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, theme } from "herdr";
import Panel from "./panel.js";

export default class FileForm extends Panel {
  init(_props, cx) {
    const p = props() ?? {};
    this.root = p.root; this.on = p.on; this.space = p.space; this.kind = "import"; this.folder = p.folder ?? "";
    this.context = { cwd: this.root, on: this.on, key: "file-form" };
    this.beginForm(this.kind, this.folder, cx);
    if (this.form) this.form.space = this.space;
  }

  current(context) { return !this.closed && context === this.context; }
  refresh() {}

  render() {
    const t = theme();
    return v_flex().id("file-form-tab").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.form ? this.formView(t) : div().p(16).text_color(t.dim).child(this.notice || "Cancelled. You can close this tab."));
  }

  close() { this.closed = true; this.endForm(); }
}
