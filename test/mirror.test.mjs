// Behavioral test: third-party details mirror in dsh-details-tabs.
// Simulates the slots core rules (single-slot same-priority throw, priority
// sort) and drives the REAL bundle's apply(ctx) through both boot orders.
import fs from "node:fs";
import assert from "node:assert/strict";

// ── fake slots core (mirrors real rules from dsh-client-ui-slots) ──────────
function makeSlots({ syncInject = false } = {}) {
  const records = new Map();
  const injectQueue = [];
  const notify = (rec) => { if (rec) for (const fn of [...rec.listeners]) { try { fn(); } catch {} } };
  const api = {
    inject: (slot, factory) => { if (syncInject) factory(); else injectQueue.push(factory); },
    register: (opts, component) => {
      const rec = records.get(opts.name);
      if (!rec || !rec.spec) throw new Error(`slot "${opts.name}" is not declared`);
      const p = opts.priority ?? 0;
      if (rec.spec.kind === "single" && rec.entries.some((g) => (g.options.priority ?? 0) === p)) {
        throw new Error(`single slot "${opts.name}" already has a registration at priority ${p}`);
      }
      if (rec.spec.kind === "keyed" && rec.entries.some((g) => g.options.key === opts.key && (g.options.priority ?? 0) === p)) {
        throw new Error(`keyed slot "${opts.name}" already has an entry for key "${opts.key}"`);
      }
      if (opts.children) {
        for (const [k, spec] of Object.entries(opts.children)) {
          const crec = records.get(k);
          if (crec && crec.spec) throw new Error(`slot "${k}" is already declared`);
          const nr = crec || { spec: null, entries: [], listeners: new Set() };
          nr.spec = spec;
          records.set(k, nr);
        }
      }
      const entry = { component, options: { ...opts } };
      rec.entries.push(entry);
      rec.entries.sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
      notify(rec);
      return () => {
        const i = rec.entries.indexOf(entry);
        if (i >= 0) { rec.entries.splice(i, 1); notify(rec); }
      };
    },
    entries: (name) => (records.get(name)?.entries ?? []),
    subscribe: (name, fn) => {
      const rec = records.get(name);
      if (!rec) return () => {};
      rec.listeners.add(fn);
      return () => rec.listeners.delete(fn);
    },
    spec: (name) => records.get(name)?.spec,
    _declare: (name, spec) => {
      let rec = records.get(name);
      if (!rec) { rec = { spec: null, entries: [], listeners: new Set() }; records.set(name, rec); }
      rec.spec = spec;
    },
    _drainInject: () => { const q = injectQueue.splice(0); for (const f of q) f(); },
    _tick: (name) => notify(records.get(name)),
  };
  return api;
}

// ── browser + loader stubs ──────────────────────────────────────────────────
let hooks = {};
const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {}, click() {}, setAttribute() {} });
const reactStub = {
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(),
  useRef: () => ({ current: null }), useContext: () => ({}),
  createElement: (...args) => ({ type: args[0], props: args[1] || {}, children: args.slice(2) }),
  Fragment: Symbol("fragment"), Children: { toArray: (c) => (Array.isArray(c) ? c : c === undefined ? [] : [c]) },
};
const jsxStub = { jsx: () => ({}), jsxs: () => ({}), Fragment: Symbol("fragment") };

function loadBundle(file) {
  globalThis.window = {
    __ModuleLoader__: { load: (b) => { hooks.bundle = b; } },
    __dshDetailsTabs__: undefined,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  };
  Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN" }, configurable: true });
  globalThis.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };
  globalThis.document = { querySelector: () => null, createElement: el, head: { appendChild() {}, removeChild() {} }, body: { appendChild() {}, removeChild() {} } };
  globalThis.require = (id) => {
    if (id === "react") return reactStub;
    if (id === "react/jsx-runtime") return jsxStub;
    if (id === "react-dom") return { createPortal: (n) => n };
    if (id === "react-dom/client") return { createRoot: () => ({ render() {}, unmount() {} }) };
    throw new Error("unexpected require: " + id);
  };
  const src = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const fn = new Function("require", src + "\n;return window.__ModuleLoader__;");
  const loader = fn(globalThis.require);
  loader.load(hooks.bundle);
  return hooks.bundle.factory(globalThis.require);
}

function runScenario({ syncInject }) {
  const slots = makeSlots({ syncInject });
  slots._declare("details", { kind: "single", scope: "session" });
  slots._declare("shell.overlay", { kind: "list" });

  // Shell registers the official tool-call DetailsPanel at priority 0 (native).
  const ShellPanel = function ShellPanel() {};
  slots.register({ name: "details", priority: 0, locale: "conversation", inject: () => ({ closeDetails: () => {} }), children: { "conversation.details.tool": { kind: "single" } } }, ShellPanel);
  // A naive third-party plugin follows the documented native pattern: details at -2.
  const ThirdParty = function ThirdParty() {};
  slots.register({ name: "details", priority: -2, label: "My Panel", inject: () => ({ closeDetails: () => {} }) }, ThirdParty);

  let intervalCb = null;
  globalThis.setInterval = (fn) => { intervalCb = fn; return 1; };
  globalThis.clearInterval = () => {};

  const cleanups = [];
  const ctx = {
    effect: (fn) => { cleanups.push(fn()); },
    locale: { register: () => () => {} },
    layout: { closeDetails: () => {}, openDetails: () => {} },
    slots,
  };

  const exp = loadBundle("dsh-details-tabs/lib/client.js");
  exp.apply(ctx);

  if (!syncInject) {
    // Deferred inject: container's details entry + child spec not yet declared
    // when the mirror's first sync ran → it failed silently and must retry.
    assert.equal(slots.entries("details.tabs.item").length, 0, "no mirrors before child slot declared");
    slots._drainInject();
    intervalCb(); // 2s interval retry
  }

  // Container should be the winning single-slot entry at -10.
  const det = slots.entries("details");
  assert.equal(det[0].options.priority, -10, "container wins the single slot");

  const tabs = slots.entries("details.tabs.item");
  const keys = tabs.map((e) => e.options.key).sort();
  assert.deepEqual(keys, ["ext:-2", "ext:0"], "both foreign entries mirrored");
  const mThird = tabs.find((e) => e.options.key === "ext:-2");
  const mShell = tabs.find((e) => e.options.key === "ext:0");
  assert.equal(mThird.component, ThirdParty, "mirror keeps third-party component");
  assert.equal(mShell.component, ShellPanel, "mirror keeps shell component");
  assert.equal(mThird.options.label, "My Panel", "mirror keeps label");
  assert.ok(typeof mThird.options.inject === "function", "mirror keeps inject factory");
  assert.equal(mShell.options.label, "详情", "zh fallback label for unnamed entries (navigator zh)");
  assert.equal(tabs.some((e) => e.component === exp.TabsContainer), false, "container is never mirrored");

  // Late third-party registration AFTER the container: subscribe fires sync.
  const LatePanel = function LatePanel() {};
  slots.register({ name: "details", priority: -5, label: "Late" }, LatePanel);
  assert.ok(slots.entries("details.tabs.item").some((e) => e.options.key === "ext:-5" && e.component === LatePanel), "late registration mirrored on change");

  // Unregistration removes the mirror.
  const before = slots.entries("details.tabs.item").length;
  const lateEntry = slots.entries("details").find((e) => e.component === LatePanel);
  const lateDisposer = () => {
    const rec = slots.entries("details");
    const i = rec.indexOf(lateEntry);
    if (i >= 0) { rec.splice(i, 1); slots._tick("details"); }
  };
  lateDisposer();
  assert.equal(slots.entries("details.tabs.item").length, before - 1, "mirror disposed on unregister");

  // Cleanup removes remaining mirrors + interval.
  for (const c of cleanups) c();
  assert.equal(slots.entries("details.tabs.item").length, 0, "cleanup clears mirrors");

  return { exp };
}

// Scenario A: inject synchronous (container details entry registered before mirror sync)
runScenario({ syncInject: true });
// Scenario B: inject deferred (worst-case boot order, retry via interval)
runScenario({ syncInject: false });

console.log("MIRROR-BEHAVIOR-OK (both boot orders)");
