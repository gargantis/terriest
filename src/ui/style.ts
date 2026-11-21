// Each module's stylesheet, added once (M4's design, research/m4/DESIGN.md,
// §0, §1.63, §11): a module that makes DOM imports its own CSS file with
// Vite's ?inline and adds it here when it first builds that DOM, so no two
// builders share a stylesheet, none ships as a file of its own, and the
// dist audit reads every style inside the JS. Each text goes into the head
// once, as one <style>. New at M4.

const added = new Set<string>();

export function addStyle(css: string): void {
  if (css === '' || added.has(css)) return;
  added.add(css);
  const el = document.createElement('style');
  el.textContent = css;
  document.head.append(el);
}
