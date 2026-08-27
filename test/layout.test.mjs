// Unit tests for the split-layout model (lib/layout.js). No React/DOM needed.
// Run: node test/layout.test.mjs

import assert from 'node:assert/strict'
import {
  leaf, split, panelsOf, hasPanel, dropOn, closePanel, setRatio, setRatioAt,
  addPanels, serialize, deserialize, splitCount,
} from '../lib/layout.js'

// ── basics ──────────────────────────────────────────────────────────────────
assert.deepEqual(panelsOf(leaf('a')), ['a'])
const row = split('row', leaf('a'), leaf('b'))
assert.deepEqual(panelsOf(row), ['a', 'b'])
assert.ok(hasPanel(row, 'a') && hasPanel(row, 'b') && !hasPanel(row, 'c'))
assert.equal(splitCount(row), 1)
assert.equal(splitCount(leaf('a')), 0)

// ── dropOn ──────────────────────────────────────────────────────────────────
// center: replace target
{
  const r = dropOn(leaf('a'), 'a', 'b', 'center')
  assert.deepEqual(r, leaf('b'))
}
// left: row split, dragged on the left
{
  const r = dropOn(leaf('a'), 'a', 'b', 'left')
  assert.deepEqual(r, split('row', leaf('b'), leaf('a')))
}
// right
{
  const r = dropOn(leaf('a'), 'a', 'b', 'right')
  assert.deepEqual(r, split('row', leaf('a'), leaf('b')))
}
// top: col split, dragged on top
{
  const r = dropOn(leaf('a'), 'a', 'b', 'top')
  assert.deepEqual(r, split('col', leaf('b'), leaf('a')))
}
// bottom
{
  const r = dropOn(leaf('a'), 'a', 'b', 'bottom')
  assert.deepEqual(r, split('col', leaf('a'), leaf('b')))
}
// drop on a split's leaf target (nested)
{
  const base = split('row', leaf('a'), leaf('b'))
  const r = dropOn(base, 'b', 'c', 'top')
  // 'b' becomes col(c, b) inside the row
  const expected = split('row', leaf('a'), split('col', leaf('c'), leaf('b')))
  assert.deepEqual(r, expected)
}
// dropping on itself is a no-op
{
  const base = split('row', leaf('a'), leaf('b'))
  assert.deepEqual(dropOn(base, 'a', 'a', 'left'), base)
}

// ── closePanel ──────────────────────────────────────────────────────────────
// close leaf in a row -> sibling survives
{
  const r = closePanel(split('row', leaf('a'), leaf('b')), 'a')
  assert.deepEqual(r, leaf('b'))
}
// close both -> null
{
  assert.deepEqual(closePanel(split('row', leaf('a'), leaf('b')), 'a'), leaf('b'))
  assert.equal(closePanel(leaf('a'), 'a'), null)
}
// close in nested tree
{
  const base = split('row', leaf('a'), split('col', leaf('b'), leaf('c')))
  const r = closePanel(base, 'b')
  assert.deepEqual(r, split('row', leaf('a'), leaf('c')))
}

// ── setRatio / serialize ────────────────────────────────────────────────────
{
  const base = split('row', leaf('a'), leaf('b'))
  const r = setRatio(base, 0.7)
  assert.equal(r.ratio, 0.7)
  assert.equal(setRatio(base, 5).ratio, 1, 'ratio clamped to 1')
  assert.equal(setRatio(base, -1).ratio, 0.05, 'ratio clamped to 0.05')
}
{
  const base = split('row', leaf('a'), split('col', leaf('b'), leaf('c')), 0.4)
  const text = serialize(base)
  const back = deserialize(text)
  assert.deepEqual(back, base, 'serialize round-trip')
  assert.equal(deserialize('not json'), null)
  assert.equal(deserialize('{"kind":"bogus"}'), null)
}

// ── setRatioAt ──────────────────────────────────────────────────────────────
{
  const base = split('row', leaf('a'), split('col', leaf('b'), leaf('c')), 0.4)
  const r = setRatioAt(base, ['b'], 0.8)
  assert.equal(r.b.ratio, 0.8, 'nested split ratio updated')
  assert.equal(r.ratio, 0.4, 'root untouched')
  assert.equal(setRatioAt(base, [], 0.9).ratio, 0.9, 'empty path = root')
  assert.equal(setRatioAt(base, ['b'], 0.5), base, 'unchanged → same ref')
  assert.equal(setRatioAt(base, ['b'], 0).b.ratio, 0.05, 'clamped low')
  assert.equal(setRatioAt(base, ['b'], 9).b.ratio, 1, 'clamped high')
  const single = leaf('a')
  assert.equal(setRatioAt(single, ['b'], 0.8), single, 'leaf is a no-op (same ref)')
}

// ── addPanels ───────────────────────────────────────────────────────────────
{
  const l1 = addPanels(null, ['a', 'b'])
  assert.deepEqual(l1, split('row', leaf('a'), leaf('b')))
  const l2 = addPanels(l1, ['a', 'b', 'c'])
  assert.deepEqual(l2, split('row', split('row', leaf('a'), leaf('b')), leaf('c')))
  assert.equal(addPanels(l2, ['a']), l2, 'no missing → same ref')
  assert.equal(addPanels(l2, ['a', 'b', 'c']), l2)
  assert.equal(addPanels(null, []), null)
}

// ── move semantics (close dragged panel first, then drop) ───────────────────
{
  const base = split('row', leaf('a'), leaf('b'))
  const moved = dropOn(closePanel(base, 'b'), 'a', 'b', 'right')
  assert.deepEqual(moved, split('row', leaf('a'), leaf('b')), 'b moves next to a')
  // center drop replaces the target and closes it (drag panel removed first)
  const replaced = dropOn(closePanel(base, 'a'), 'b', 'a', 'center')
  assert.deepEqual(replaced, leaf('a'))
  // ratio clamp in split() applies on bad ratios
  assert.equal(split('row', leaf('a'), leaf('b'), 3).ratio, 1)
}

console.log('dsh-details-tabs: layout assertions passed')
