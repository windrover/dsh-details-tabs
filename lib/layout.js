// dsh-details-tabs — split layout model (pure, testable).
//
// The details column can show several panels at once in a Blender-style
// editor layout: a tree of leaves (one panel each) and splits (row/col with a
// ratio). This module owns the tree algebra — split, swap, close, ratio,
// flatten, serialize — with no React/DOM dependency so it can be unit-tested
// standalone.

/** A leaf layout: one panel. */
export function leaf(panel) {
  return { kind: 'leaf', panel }
}

/** A split layout: two sub-layouts side by side (row) or stacked (col). */
export function split(dir, a, b, ratio = 0.5) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : 0.5
  return { kind: 'split', dir: dir === 'col' ? 'col' : 'row', ratio: r, a, b }
}

/** All panel keys present in a layout (unique, depth-first). */
export function panelsOf(layout) {
  const out = []
  const seen = new Set()
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (node.kind === 'leaf') {
      if (!seen.has(node.panel)) { seen.add(node.panel); out.push(node.panel) }
      return
    }
    if (node.kind === 'split') { walk(node.a); walk(node.b) }
  }
  walk(layout)
  return out
}

/** Whether `panel` is present anywhere in the layout. */
export function hasPanel(layout, panel) {
  return panelsOf(layout).includes(panel)
}

/**
 * Split a leaf (found by target panel) into two leaves, or into a leaf and a
 * sub-layout, placing `drag` beside/above it.
 *
 * dropZone:
 *   'center'  — replace the target leaf with `drag` (swap).
 *   'left'/'right' — row split with the dragged panel on that side.
 *   'top'/'bottom' — col split with the dragged panel on that side.
 *
 * The target leaf is replaced by a split of (drag, target) in the requested
 * direction; 'center' replaces the target with drag alone. If the target is
 * not a leaf (it's a split), the drop applies to the split node: dragging
 * onto a split's edge nests one level deeper.
 */
export function dropOn(layout, targetPanel, dragPanel, zone) {
  if (layout === null || layout === undefined) return leaf(dragPanel)
  if (dragPanel === targetPanel) return layout // dropping on itself: no-op
  const replaceLeaf = (node) => {
    if (node.kind !== 'leaf' || node.panel !== targetPanel) return null
    if (zone === 'center') return leaf(dragPanel)
    if (zone === 'left') return split('row', leaf(dragPanel), node)
    if (zone === 'right') return split('row', node, leaf(dragPanel))
    if (zone === 'top') return split('col', leaf(dragPanel), node)
    if (zone === 'bottom') return split('col', node, leaf(dragPanel))
    return node
  }
  const walk = (node) => {
    if (node === null || node === undefined) return null
    if (node.kind === 'leaf') return replaceLeaf(node) ?? node
    const a = walk(node.a)
    const b = walk(node.b)
    if (a === node.a && b === node.b) return node
    return { ...node, a, b }
  }
  return walk(layout)
}

/**
 * Remove a panel from the layout. Removing a leaf collapses its parent split
 * (the sibling survives). Removing the last leaf yields null (empty).
 */
export function closePanel(layout, panel) {
  if (layout === null || layout === undefined) return null
  if (layout.kind === 'leaf') return layout.panel === panel ? null : layout
  const a = closePanel(layout.a, panel)
  const b = closePanel(layout.b, panel)
  if (a === null && b === null) return null
  if (a === null) return b
  if (b === null) return a
  if (a === layout.a && b === layout.b) return layout
  return { ...layout, a, b }
}

/** Adjust the ratio of one split node (matched by reference path via fn). */
export function setRatio(layout, ratio) {
  if (layout === null || layout === undefined) return layout
  if (layout.kind !== 'split') return layout
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : layout.ratio
  return { ...layout, ratio: r }
}

/**
 * Set the ratio of the split node reached by walking `path` ('a'/'b' steps
 * from the root; empty path = the root itself). Returns the same reference
 * when nothing changed.
 */
export function setRatioAt(layout, path, ratio) {
  if (layout === null || layout === undefined || layout.kind !== 'split') return layout
  const dirs = Array.isArray(path) ? path : []
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : layout.ratio
  if (dirs.length === 0) return r === layout.ratio ? layout : { ...layout, ratio: r }
  const [head, ...rest] = dirs
  const key = head === 'b' ? 'b' : 'a'
  const nextChild = setRatioAt(layout[key], rest, ratio)
  if (nextChild === layout[key]) return layout
  return { ...layout, [key]: nextChild }
}

/**
 * Ensure every key in `keys` is present in the layout; missing ones are
 * appended as new leaves (each new panel splits the tree to the right).
 * Returns the same reference when nothing changed.
 */
export function addPanels(layout, keys) {
  let next = layout
  for (const key of keys) {
    if (next !== null && next !== undefined && hasPanel(next, key)) continue
    next = next === null || next === undefined ? leaf(key) : split('row', next, leaf(key))
  }
  return next
}

/**
 * Remove every leaf whose panel key is not in `keys` (deregistered panels —
 * a removed plugin, an unmirrored shell panel, a stale persisted layout).
 * Returns the same reference when nothing changed.
 */
export function prunePanels(layout, keys) {
  if (layout === null || layout === undefined) return layout
  const keep = new Set(keys ?? [])
  if (panelsOf(layout).every((p) => keep.has(p))) return layout
  let next = layout
  for (const panel of panelsOf(layout)) {
    if (!keep.has(panel)) next = closePanel(next, panel)
  }
  return next
}

/** Flatten a layout into an ordered list of leaf panels (for the tab bar). */
export function flatPanels(layout) {
  return panelsOf(layout)
}

/** Serialize to JSON (for localStorage). */
export function serialize(layout) {
  return JSON.stringify(layout)
}

/** Parse from JSON; returns null on malformed input or non-layout shape. */
export function deserialize(text) {
  try {
    const data = JSON.parse(String(text ?? ''))
    if (data === null || typeof data !== 'object') return null
    if (data.kind === 'leaf' && typeof data.panel === 'string') return { kind: 'leaf', panel: data.panel }
    if (data.kind === 'split' && (data.dir === 'row' || data.dir === 'col')) {
      const a = deserialize(JSON.stringify(data.a))
      const b = deserialize(JSON.stringify(data.b))
      if (a === null || b === null) return null
      const ratio = Number.isFinite(data.ratio) ? Math.min(1, Math.max(0.05, data.ratio)) : 0.5
      return split(data.dir, a, b, ratio)
    }
    return null
  } catch { return null }
}

/** Count of split nodes (a complexity gauge). */
export function splitCount(layout) {
  if (layout === null || layout === undefined) return 0
  if (layout.kind === 'leaf') return 0
  return 1 + splitCount(layout.a) + splitCount(layout.b)
}

export default {
  leaf, split, panelsOf, hasPanel, dropOn, closePanel, setRatio, setRatioAt,
  addPanels, prunePanels, flatPanels, serialize, deserialize, splitCount,
}
