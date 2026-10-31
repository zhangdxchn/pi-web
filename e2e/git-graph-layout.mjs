import assert from "node:assert/strict";

// Measure the real toolbar rather than just checking that the input exists:
// flex items can be present and clickable while the search field is squeezed.
export async function checkGitGraphToolbarLayout({ panel, search, allBranches, refresh, minSearchWidth, placeholderFits }) {
  const input = panel.getByLabel(search, { exact: true });
  const branch = panel.getByRole("button", { name: allBranches, exact: true });
  const toolbar = branch.locator("..").locator("..");
  const refreshButton = toolbar.getByRole("button", { name: refresh, exact: true });
  await input.waitFor({ state: "visible" });
  assert.equal(await toolbar.getByText(/^(Commits:|提交：)/).count(), 0, "The commit count must not occupy the toolbar");

  const layout = await toolbar.evaluate((element, refreshLabel) => {
    const input = element.querySelector('input[type="text"]');
    const branch = element.querySelector("button");
    const refresh = Array.from(element.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === refreshLabel);
    const remote = element.querySelector("label");
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const style = getComputedStyle(input);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = style.font;
    return {
      toolbar: rect(element),
      input: rect(input),
      branch: rect(branch),
      refresh: rect(refresh),
      remote: remote ? rect(remote) : null,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      textWidth: context.measureText(input.placeholder).width,
      textSpace: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  }, refresh);
  await refreshButton.waitFor({ state: "visible" });
  assert.ok(layout.input.width >= minSearchWidth, `Search is too narrow: ${JSON.stringify(layout)}`);
  if (placeholderFits) {
    assert.ok(layout.textSpace >= layout.textWidth, `Placeholder is clipped: ${JSON.stringify(layout)}`);
  }
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `Toolbar overflows: ${JSON.stringify(layout)}`);
  const controls = [layout.branch, layout.remote, layout.input, layout.refresh].filter(Boolean);
  for (const control of controls) {
    assert.ok(control.left >= layout.toolbar.left - 1 && control.right <= layout.toolbar.right + 1
      && control.top >= layout.toolbar.top - 1 && control.bottom <= layout.toolbar.bottom + 1,
    `A control is outside the toolbar: ${JSON.stringify(layout)}`);
  }
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      const overlaps = a.left < b.right - 1 && b.left < a.right - 1
        && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      assert.equal(overlaps, false, `Toolbar controls overlap: ${JSON.stringify(layout)}`);
    }
  }
  return layout;
}
