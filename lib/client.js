/**
 * dsh-details-tabs — Browser half.
 *
 * Owns the single `details` slot (priority -1) and renders it as a Blender
 * style editor: registered panels shown in a split layout (side by side in
 * row/col splits, draggable dividers, drop zones to split/replace/close).
 *
 * Layout model (lib/layout.js, pure + unit-tested):
 *   leaf(panel) | split(dir, a, b, ratio)
 * Panels register into the keyed child slot `details.tabs.item` (key = panel
 * id, options.label = panel title). The top strip lists every registered
 * panel (open = highlighted, click reopens a closed one); the layout area
 * renders the tree. Drag a panel header onto another panel and drop on a
 * zone (left/right/top/bottom = split, center = replace). Dividers drag to
 * resize. Layout persists in localStorage per browser origin.
 *
 * Third-party compatibility: the container registers `details` at -10 (a
 * single slot renders the lowest priority, so -10 always wins) and mirrors
 * every FOREIGN `details` registration into `details.tabs.item` (same
 * component + inject) — see mountThirdPartyMirror. Plugins that only know
 * the native pattern (register into `details`, e.g. the official tool-call
 * DetailsPanel) appear as ordinary container panels with zero changes on
 * their side.
 *
 * Hang-safety (two browser freezes happened in earlier drafts — don't regress):
 *   - layout state is initialized lazily (useState(readLayout));
 *   - every layout mutation happens ONLY in user-interaction handlers
 *     (drop / close / divider / chip click / rail activate), never in an
 *     effect that depends on layout;
 *   - all setLayout calls use functional updates and bail out via reference
 *     equality (the pure functions return the same object on no-op), so an
 *     unchanged update never re-renders.
 *
 * Also owns the window chrome for the details column:
 *   - a Blender-style vertical dock rail along the right edge when the
 *     column is collapsed, listing every registered panel for one-click open
 *     (this is the single entry point for reopening the column);
 *
 * Adding a new panel = register into `details.tabs.item` with a unique key
 * and label — no slot conflict, no priority wrestling.
 */
window.__ModuleLoader__.load({
	id: "dsh-details-tabs",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");

		//#region lib/types/client/locales.js
		const NS = "details-tabs";
		const zh = {
			"panel.close": "关闭",
			"panel.empty": "（无面板）",
			"panel.open": "窗口",
			"panel.collapse": "收起",
			"panel.reset": "重置布局（清空旧排列，纵向堆叠）",
			"panel.toggle": "点击显示/隐藏此面板",
			"panel.drag": "拖拽面板标题到另一面板上：左右/上下=并排，中间=替换",
		};
		const en = {
			"panel.close": "Close",
			"panel.empty": "(no panels)",
			"panel.open": "Windows",
			"panel.collapse": "Collapse",
			"panel.reset": "Reset layout (clear stale arrangement, stack vertically)",
			"panel.toggle": "Click to show/hide this panel",
			"panel.drag": "Drag a panel header onto another: sides = split, center = replace",
		};
		//#endregion

		//#region lib/types/client/order.js
		/** localStorage key for the strip order (per browser origin). */
		const ORDER_KEY = "dsh-details-tabs:order";
		/** Global activation channel shared between TabsContainer and DockRail. */
		const SHARED = window.__dshDetailsTabs__ || (window.__dshDetailsTabs__ = { activeKey: null });
		/** Read the persisted tab order (array of keys), or null. */
		function readOrder() {
			try {
				const raw = localStorage.getItem(ORDER_KEY);
				const parsed = raw ? JSON.parse(raw) : null;
				return Array.isArray(parsed) ? parsed : null;
			} catch { return null; }
		}
		/** Persist the tab order. */
		function writeOrder(order) {
			try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
		}
		/** Order `entries` by persisted order, unknown/new keys appended in slot order. */
		function applyOrder(entries) {
			const saved = readOrder();
			if (saved === null || saved.length === 0) return entries;
			const byKey = new Map(entries.map((e) => [e.options?.key, e]));
			const ordered = [];
			const seen = new Set();
			for (const key of saved) {
				const entry = byKey.get(key);
				if (entry !== undefined) { ordered.push(entry); seen.add(key); }
			}
			for (const entry of entries) {
				if (!seen.has(entry.options?.key)) ordered.push(entry);
			}
			return ordered;
		}
		//#endregion

		//#region lib/types/client/layout.js
		// Split-layout algebra (kept in sync with lib/layout.js, exports stripped
		// for the bundle). Pure functions: no-ops return the SAME reference.
		function leaf(panel) {
			return { kind: 'leaf', panel }
		}
		function split(dir, a, b, ratio = 0.5) {
			const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : 0.5;
			return { kind: 'split', dir: dir === 'col' ? 'col' : 'row', ratio: r, a, b }
		}
		function panelsOf(layout) {
			const out = [];
			const seen = new Set();
			const walk = (node) => {
				if (node === null || node === undefined) return;
				if (node.kind === 'leaf') {
					if (!seen.has(node.panel)) { seen.add(node.panel); out.push(node.panel); }
					return;
				}
				if (node.kind === 'split') { walk(node.a); walk(node.b); }
			};
			walk(layout);
			return out;
		}
		function hasPanel(layout, panel) {
			return panelsOf(layout).includes(panel);
		}
		function dropOn(layout, targetPanel, dragPanel, zone) {
			if (layout === null || layout === undefined) return leaf(dragPanel);
			if (dragPanel === targetPanel) return layout;
			const replaceLeaf = (node) => {
				if (node.kind !== 'leaf' || node.panel !== targetPanel) return null;
				if (zone === 'center') return leaf(dragPanel);
				if (zone === 'left') return split('row', leaf(dragPanel), node);
				if (zone === 'right') return split('row', node, leaf(dragPanel));
				if (zone === 'top') return split('col', leaf(dragPanel), node);
				if (zone === 'bottom') return split('col', node, leaf(dragPanel));
				return node;
			};
			const walk = (node) => {
				if (node === null || node === undefined) return null;
				if (node.kind === 'leaf') return replaceLeaf(node) ?? node;
				const a = walk(node.a);
				const b = walk(node.b);
				if (a === node.a && b === node.b) return node;
				return { ...node, a, b };
			};
			return walk(layout);
		}
		function closePanel(layout, panel) {
			if (layout === null || layout === undefined) return null;
			if (layout.kind === 'leaf') return layout.panel === panel ? null : layout;
			const a = closePanel(layout.a, panel);
			const b = closePanel(layout.b, panel);
			if (a === null && b === null) return null;
			if (a === null) return b;
			if (b === null) return a;
			if (a === layout.a && b === layout.b) return layout;
			return { ...layout, a, b };
		}
		function setRatioAt(layout, path, ratio) {
			if (layout === null || layout === undefined || layout.kind !== 'split') return layout;
			const dirs = Array.isArray(path) ? path : [];
			const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0.05, ratio)) : layout.ratio;
			if (dirs.length === 0) return r === layout.ratio ? layout : { ...layout, ratio: r };
			const [head, ...rest] = dirs;
			const key = head === 'b' ? 'b' : 'a';
			const nextChild = setRatioAt(layout[key], rest, ratio);
			if (nextChild === layout[key]) return layout;
			return { ...layout, [key]: nextChild };
		}
		function addPanels(layout, keys) {
			let next = layout;
			for (const key of keys) {
				if (next !== null && next !== undefined && hasPanel(next, key)) continue;
				// Stack vertically (col) by default: side-by-side rows make
				// every panel unreadable in the narrow details column.
				next = next === null || next === undefined ? leaf(key) : split('col', next, leaf(key));
			}
			return next;
		}
		function prunePanels(layout, keys) {
			if (layout === null || layout === undefined) return layout;
			const keep = new Set(keys ?? []);
			if (panelsOf(layout).every((p) => keep.has(p))) return layout;
			let next = layout;
			for (const panel of panelsOf(layout)) {
				if (!keep.has(panel)) next = closePanel(next, panel);
			}
			return next;
		}
		/** Minimum width for a row-split child (px): a side-by-side panel below
		 *  this is unreadable, so the flex layout refuses to compress it. */
		const MIN_PANEL_WIDTH = 140;
		function deserialize(text) {
			try {
				const data = JSON.parse(String(text ?? ''));
				if (data === null || typeof data !== 'object') return null;
				if (data.kind === 'leaf' && typeof data.panel === 'string') return { kind: 'leaf', panel: data.panel };
				if (data.kind === 'split' && (data.dir === 'row' || data.dir === 'col')) {
					const a = deserialize(JSON.stringify(data.a));
					const b = deserialize(JSON.stringify(data.b));
					if (a === null || b === null) return null;
					const ratio = Number.isFinite(data.ratio) ? Math.min(1, Math.max(0.05, data.ratio)) : 0.5;
					return split(data.dir, a, b, ratio);
				}
				return null;
			} catch { return null; }
		}
		//#endregion

		//#region lib/types/client/persist.js
		/** localStorage key for the split layout tree. */
		const LAYOUT_KEY = "dsh-details-tabs:layout";
		/** localStorage marker value meaning "user closed every panel". */
		const LAYOUT_EMPTY_MARKER = "[]";
		/**
		 * Sentinel layout state: the user explicitly closed all panels, so the
		 * periodic refresh must NOT auto-add registered panels back. Distinct
		 * from `null` (nothing persisted yet → first refresh auto-adds).
		 */
		const EMPTY = {};
		/** Read the persisted layout: tree | EMPTY (closed all) | null (never). */
		function readLayout() {
			try {
				const raw = localStorage.getItem(LAYOUT_KEY);
				if (raw === null) return null;
				if (raw === LAYOUT_EMPTY_MARKER || raw === "null") return EMPTY;
				const tree = deserialize(raw);
				return tree === null ? null : tree;
			} catch { return null; }
		}
		/** Persist the layout; EMPTY stores the marker, null removes the key. */
		function persistLayout(layout) {
			try {
				if (layout === EMPTY) localStorage.setItem(LAYOUT_KEY, LAYOUT_EMPTY_MARKER);
				else if (layout === null || layout === undefined) localStorage.removeItem(LAYOUT_KEY);
				else localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
			} catch { /* ignore */ }
		}
		//#endregion

		//#region lib/types/client/closed.js
		/**
		 * The set of panel keys the user explicitly CLOSED. The 2s refresh
		 * auto-adds registered panels that are missing from the layout (so a
		 * newly registered panel appears), but that would also resurrect a panel
		 * the user just closed. This buffer makes "close = stay hidden until I
		 * click the chip" stick across refreshes and restarts.
		 */
		const CLOSED_KEY = "dsh-details-tabs:closed";
		function readClosed() {
			try {
				const raw = localStorage.getItem(CLOSED_KEY);
				const parsed = raw ? JSON.parse(raw) : null;
				return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
			} catch { return []; }
		}
		function writeClosed(keys) {
			try { localStorage.setItem(CLOSED_KEY, JSON.stringify(keys)); } catch { /* ignore */ }
		}
		//#endregion

		//#region lib/types/client/TabsContainer.js
		/**
		 * The split-layout details column.
		 *
		 * Props: { t, renderSlot, tabEntries, closeDetails, SessionProvider }
		 *
		 * State rules (see header comment — hang safety):
		 *   - `layout` starts from localStorage via lazy useState init;
		 *   - `refresh` (interval + mount) only appends MISSING panels and is
		 *     dependency-stable ([tabEntries]); it never depends on layout;
		 *   - every other mutation is a user-interaction handler using a
		 *     functional setLayout that bails out when the pure function
		 *     returns the same reference.
		 */
		function TabsContainer(props) {
			const { t, renderSlot, tabEntries, closeDetails, SessionProvider } = props;
			const [layout, setLayout] = react.useState(readLayout);
			const [entries, setEntries] = react.useState([]);
			const [activeKey, setActiveKeyState] = react.useState(SHARED.activeKey);
			const [drag, setDrag] = react.useState(null);
			const [chipDragKey, setChipDragKey] = react.useState(null);
			// Panels the user explicitly closed — kept out of refresh auto-add.
			const closedRef = react.useRef(readClosed());
			const markClosed = (key) => {
				if (typeof key !== "string" || closedRef.current.includes(key)) return;
				closedRef.current = closedRef.current.concat(key);
				writeClosed(closedRef.current);
			};
			const unmarkClosed = (key) => {
				if (!closedRef.current.includes(key)) return;
				closedRef.current = closedRef.current.filter((k) => k !== key);
				writeClosed(closedRef.current);
			};

			const setActiveKey = react.useCallback((key) => {
				SHARED.activeKey = key;
				setActiveKeyState(key);
			}, []);

			// Periodic refresh: re-sync the registered panel list and append any
			// newly registered panel to the layout. Never touches layout on a
			// no-op (addPanels returns the same reference) → no render loop.
			const refresh = react.useCallback(() => {
				let list = [];
				try { list = (tabEntries ? tabEntries() : []) || []; } catch { list = []; }
				const keys = [];
				for (const e of list) { const k = e.options?.key; if (k) keys.push(k); }
				// Mirrored (external) panels — keys prefixed "ext:" — start
				// CLOSED: they surface as dimmed strip chips and open on click,
				// never auto-added to the layout (an external panel appearing as
				// a surprise leaf is what made the official details panel look
				// like a stray window). First-class panels auto-add as before,
				// EXCEPT ones the user explicitly closed (closedRef) — closing is
				// meant to hide a panel, not just momentarily remove it.
				const autoKeys = keys.filter((k) => !k.startsWith("ext:") && !closedRef.current.includes(k));
				setEntries((prev) => {
					const next = applyOrder(list);
					if (prev.length === next.length && prev.every((e, i) => e === next[i])) return prev;
					return next;
				});
				setActiveKeyState((current) => {
					if (current !== null && keys.includes(current)) return current;
					const fallback = keys[0] ?? null;
					SHARED.activeKey = fallback;
					return fallback;
				});
				setLayout((prev) => {
					if (prev === EMPTY) return prev; // user closed all — keep closed
					// Prune leaves whose panel is no longer registered at all
					// (removed plugin, unmirrored shell panel, stale persisted
					// layout), then auto-add missing first-class panels.
					let next = prunePanels(prev, keys);
					next = addPanels(next, autoKeys);
					if (next === prev) return prev;
					persistLayout(next);
					return next;
				});
			}, [tabEntries]);

			react.useEffect(() => {
				refresh();
				const timer = setInterval(refresh, 2000);
				// Listen for dock-rail activation (DockRail writes SHARED.activeKey
				// and dispatches this event). Reopen the panel in the layout too.
				const onActivate = () => {
					if (SHARED.activeKey !== null) {
						setActiveKeyState(SHARED.activeKey);
						unmarkClosed(SHARED.activeKey); // explicit open via rail
						setLayout((prev) => {
							const base = prev === EMPTY ? null : prev;
							const next = addPanels(base, [SHARED.activeKey]);
							if (next === base) return prev;
							persistLayout(next);
							return next;
						});
					}
				};
				window.addEventListener("dsh-details-tabs-activate", onActivate);
				return () => { clearInterval(timer); window.removeEventListener("dsh-details-tabs-activate", onActivate); };
			}, [refresh]);

			// Publish the current open-panel keys for the DockRail (collapsed
			// state) so it only shows panels that are actually open. Writing a
			// module var is not a state update — no render, no loop.
			react.useEffect(() => {
				SHARED.openKeys = panelsOf(layout);
			}, [layout]);

			const labelOf = react.useCallback((key) => {
				for (const e of entries) { if (e.options?.key === key) return e.options?.label || key; }
				return key;
			}, [entries]);

			// ── layout mutations: user-interaction handlers only ────────────────
			const closePanelHandler = (panel) => {
				markClosed(panel); // closing must stay hidden (not auto-re-added)
				setLayout((prev) => {
					const next = closePanel(prev, panel);
					if (next === prev) return prev;
					if (next === null) { persistLayout(EMPTY); return EMPTY; } // all closed
					persistLayout(next);
					return next;
				});
			};

			const reopenPanel = (panel) => {
				unmarkClosed(panel); // user chose to show it again
				setLayout((prev) => {
					const base = prev === EMPTY ? null : prev;
					const next = addPanels(base, [panel]);
					if (next === base) return prev;
					persistLayout(next);
					return next;
				});
			};

			// Drop on a leaf: move semantics — remove the dragged panel from its
			// current spot first, then place it beside/onto the target.
			const dropOnLeaf = (targetKey, e) => {
				e.preventDefault();
				e.stopPropagation(); // inner leaves win over outer ones
				if (drag === null) return;
				const panel = drag.panel;
				const zone = drag.zone || "center";
				if (panel === targetKey) { setDrag(null); return; }
				setLayout((prev) => {
					let next = closePanel(prev, panel);
					next = dropOn(next, targetKey, panel, zone);
					if (next === prev) return prev;
					persistLayout(next);
					return next;
				});
				setDrag(null);
			};

			// Divider drag: functional updates only (mousemove storm).
			const startDividerDrag = (path, dir, e) => {
				e.preventDefault();
				const container = e.currentTarget.parentElement;
				const rect = container.getBoundingClientRect();
				const isRow = dir === "row";
				const onMove = (ev) => {
					const pos = isRow ? ev.clientX - rect.left : ev.clientY - rect.top;
					const total = (isRow ? rect.width : rect.height) || 1;
					const ratio = Math.min(0.95, Math.max(0.05, pos / total));
					setLayout((prev) => {
						const next = setRatioAt(prev, path, ratio);
						if (next === prev) return prev;
						persistLayout(next);
						return next;
					});
				};
				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};

			// ── render helpers ───────────────────────────────────────────────────
			const renderPanel = (key) => {
				try {
					// `embedded: true` tells the child panel it is rendered inside a
					// container: panels that ship their own standalone chrome
					// (title bar + close button) must hide it here — the leaf
					// header below is the single chrome. ownerProps win in the
					// renderer merge, so this overrides any panel-side value.
					const rendered = renderSlot("details.tabs.item", { embedded: true }, { entryKey: key });
					// The child slot is session-scoped; wrap with the injected
					// SessionProvider so panels receive session hooks (useSessions /
					// useWorkspaces). Without it, session-scoped children render
					// nothing (strict-session-absent). SessionProvider takes a
					// children(id) function.
					return typeof SessionProvider === "function"
						? react.createElement(SessionProvider, { children: () => rendered })
						: rendered;
				} catch (err) {
					return react.createElement("div", { style: { opacity: .6 } }, String(err?.message || err));
				}
			};

			const leafDragOver = (key) => (e) => {
				if (drag === null || drag.panel === key) return;
				e.preventDefault();
				e.stopPropagation(); // inner leaves win over outer ones
				try { e.dataTransfer.dropEffect = "move"; } catch { /* ignore */ }
				const rect = e.currentTarget.getBoundingClientRect();
				const x = (e.clientX - rect.left) / (rect.width || 1);
				const y = (e.clientY - rect.top) / (rect.height || 1);
				const zone = x < 0.25 ? "left" : x > 0.75 ? "right" : y < 0.25 ? "top" : y > 0.75 ? "bottom" : "center";
				setDrag((prev) =>
					(prev !== null && prev.panel === drag.panel && prev.over === key && prev.zone === zone)
						? prev
						: { panel: drag.panel, over: key, zone });
			};

			const zoneOverlay = (key) => {
				if (drag === null || drag.over !== key || drag.panel === key) return null;
				const base = { position: "absolute", pointerEvents: "none", background: "rgba(60,140,255,.28)", borderRadius: 3, zIndex: 5 };
				let style;
				if (drag.zone === "left") style = { ...base, left: 0, top: 0, bottom: 0, width: "50%" };
				else if (drag.zone === "right") style = { ...base, right: 0, top: 0, bottom: 0, width: "50%" };
				else if (drag.zone === "top") style = { ...base, top: 0, left: 0, right: 0, height: "50%" };
				else if (drag.zone === "bottom") style = { ...base, bottom: 0, left: 0, right: 0, height: "50%" };
				else style = { ...base, inset: 0 };
				return react.createElement("div", { style });
			};

			const renderLeaf = (key) => {
				const label = labelOf(key);
				return react.createElement("div", {
					key,
					onDragOver: leafDragOver(key),
					onDrop: (e) => dropOnLeaf(key, e),
					style: { position: "relative", display: "flex", flexDirection: "column", height: "100%", width: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", background: "rgba(128,128,128,.02)" },
				},
					react.createElement("div", {
						draggable: true,
						title: t("panel.drag"),
						onDragStart: (e) => {
							try { e.dataTransfer.setData("text/plain", key); e.dataTransfer.effectAllowed = "move"; } catch { /* ignore */ }
							setDrag({ panel: key, over: null, zone: null });
						},
						onDragEnd: () => setDrag(null),
						style: { display: "flex", alignItems: "center", gap: 4, padding: "2px 6px", fontSize: 11, cursor: "grab", userSelect: "none", background: "rgba(128,128,128,.08)", borderBottom: "1px solid rgba(128,128,128,.15)" },
					},
						react.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label),
						react.createElement("button", {
							onClick: (e) => { e.stopPropagation(); closePanelHandler(key); },
							title: t("panel.close"),
							style: { flex: "0 0 auto", border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "2px 4px", opacity: .7 },
						}, "×"),
					),
					react.createElement("div", { style: { flex: 1, minHeight: 0, overflow: "hidden", position: "relative" } },
						renderPanel(key),
						zoneOverlay(key),
					),
				);
			};

			const renderSplit = (node, path) => {
				const isRow = node.dir === "row";
				const dir = isRow ? "row" : "column";
				// minWidth: a row-split child must stay readable; below
				// MIN_PANEL_WIDTH the flex layout refuses to compress it.
				const aFlex = isRow
					? { flex: `0 0 calc(${node.ratio * 100}% - 2.5px)`, minWidth: MIN_PANEL_WIDTH }
					: { flex: `0 0 calc(${node.ratio * 100}% - 2.5px)`, minHeight: 0 };
				const bFlex = isRow ? { flex: "1 1 0%", minWidth: MIN_PANEL_WIDTH } : { flex: "1 1 0%", minHeight: 0 };
				const dividerStyle = isRow
					? { flex: "0 0 5px", cursor: "col-resize", background: "rgba(128,128,128,.15)" }
					: { flex: "0 0 5px", cursor: "row-resize", background: "rgba(128,128,128,.15)" };
				return react.createElement("div", {
					key: "s:" + path.join("/"),
					style: { display: "flex", flexDirection: dir, height: "100%", width: "100%", minWidth: 0, minHeight: 0, overflow: "hidden" },
				},
					react.createElement("div", { style: { ...aFlex, overflow: "hidden", position: "relative" } }, renderNode(node.a, [...path, "a"])),
					react.createElement("div", { style: dividerStyle, onMouseDown: (e) => startDividerDrag(path, node.dir, e) }),
					react.createElement("div", { style: { ...bFlex, overflow: "hidden", position: "relative" } }, renderNode(node.b, [...path, "b"])),
				);
			};

			const renderNode = (node, path) => {
				if (node === null || node === undefined) return null;
				if (node.kind === "leaf") return renderLeaf(node.panel);
				return renderSplit(node, path);
			};

			// ── strip: every registered panel. Chips TOGGLE: click an open
			// (blue) chip to hide its panel, a dimmed chip to show it. Chips
			// also drag to reorder (persisted via ORDER_KEY). ──
			const onChipDrop = (targetKey) => {
				if (chipDragKey === null || chipDragKey === targetKey) { setChipDragKey(null); return; }
				setEntries((prev) => {
					const next = prev.slice();
					const from = next.findIndex((e) => e.options?.key === chipDragKey);
					const to = next.findIndex((e) => e.options?.key === targetKey);
					if (from < 0 || to < 0) return prev;
					const [moved] = next.splice(from, 1);
					next.splice(to, 0, moved);
					writeOrder(next.map((e) => e.options?.key));
					return next;
				});
				setChipDragKey(null);
			};
			const stripChips = entries.map((entry) => {
				const key = entry.options?.key;
				const label = entry.options?.label || key;
				const open = key !== undefined && hasPanel(layout, key);
				return react.createElement("button", {
					key,
					title: label + " — " + t("panel.toggle"),
					draggable: true,
					onDragStart: (e) => {
						setChipDragKey(key);
						try { e.dataTransfer.setData("text/plain", key); e.dataTransfer.effectAllowed = "move"; } catch { /* ignore */ }
					},
					onDragEnd: () => setChipDragKey(null),
					onDragOver: (e) => {
						if (chipDragKey !== null && chipDragKey !== key) {
							e.preventDefault();
							try { e.dataTransfer.dropEffect = "move"; } catch { /* ignore */ }
						}
					},
					onDrop: (e) => { e.preventDefault(); onChipDrop(key); },
					onClick: () => { if (open) closePanelHandler(key); else reopenPanel(key); },
					style: {
						flex: "0 0 auto", padding: "3px 8px", fontSize: 11,
						border: "1px solid " + (open ? "rgba(60,140,255,.55)" : "rgba(128,128,128,.25)"),
						borderRadius: 10, background: open ? "rgba(60,140,255,.10)" : "transparent",
						color: open ? "inherit" : "rgba(128,128,128,.6)",
						cursor: "grab", whiteSpace: "nowrap",
						...(chipDragKey === key ? { opacity: .4 } : {}),
					},
				}, label);
			});

			// Reset: clear the persisted layout (including stale ext:* leaves
			// from earlier builds) and rebuild immediately, stacking vertically.
			const resetLayout = () => {
				const keys = entries
					.map((e) => e.options?.key)
					.filter((k) => typeof k === "string" && k.length > 0 && !k.startsWith("ext:"));
				closedRef.current = [];
				writeClosed([]); // reset = everything open again
				try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ }
				const next = addPanels(null, keys);
				if (next !== null) persistLayout(next);
				setLayout(next);
			};
			const resetBtn = react.createElement("button", {
				key: "__reset",
				onClick: resetLayout,
				title: t("panel.reset"),
				style: { flex: "0 0 auto", marginLeft: 6, border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12, opacity: .7, padding: "2px 4px" },
			}, "↺");

			const collapseBtn = typeof closeDetails === "function"
				? react.createElement("button", {
					key: "__collapse",
					onClick: closeDetails,
					title: t("panel.collapse"),
					style: { flex: "0 0 auto", marginLeft: 6, border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12, opacity: .7, padding: "2px 4px" },
				}, "»")
				: null;

			return react.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%", width: "100%", minWidth: 0, minHeight: 0 } },
				react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", borderBottom: "1px solid rgba(128,128,128,.2)", overflowX: "auto", flex: "0 0 auto" } },
					...stripChips,
					resetBtn,
					collapseBtn,
				),
				react.createElement("div", { style: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", position: "relative" } },
					layout === null || layout === undefined || layout === EMPTY
						? react.createElement("div", { style: { opacity: .6, padding: 10, fontSize: 12 } }, t("panel.empty"))
						: renderNode(layout, []),
				),
			);
		}
		//#endregion

		//#region lib/types/client/WindowChrome.js
		/**
		 * True while the details column is open, read off the shell frame's
		 * `data-details-collapsed` attribute (same technique as the artifacts
		 * trigger used).
		 */
		function useDetailsOpen() {
			const [open, setOpen] = react.useState(false);
			react.useEffect(() => {
				const layer = document.querySelector("[data-shell-overlay]");
				const frame = layer !== null && layer.parentElement !== null ? layer.parentElement : null;
				if (frame === null) return;
				const update = () => setOpen(!frame.hasAttribute("data-details-collapsed"));
				update();
				const observer = new MutationObserver(update);
				observer.observe(frame, { attributes: true, attributeFilter: ["data-details-collapsed"] });
				return () => observer.disconnect();
			}, []);
			return open;
		}

		/**
		 * Blender-style vertical dock rail: shown along the right edge while the
		 * details column is collapsed. Lists every registered panel as a small
		 * vertical tile; clicking one opens the column on that panel.
		 */
		function DockRail({ t, tabEntries, openDetails }) {
			const open = useDetailsOpen();
			const [entries, setEntries] = react.useState([]);
			react.useEffect(() => {
				const update = () => {
					let list = [];
					try { list = (tabEntries ? tabEntries() : []) || []; } catch { list = []; }
					setEntries(list);
				};
				update();
				const timer = setInterval(update, 2000);
				return () => clearInterval(timer);
			}, [tabEntries]);
			if (open) return null;
			// Only OPEN panels get a rail tile — a closed (hidden) panel must
			// not appear as if it were available. The container publishes its
			// open keys on SHARED.openKeys; closed ones are dropped, and a
			// stray mirror (ext:) is never listed either.
			const openKeys = new Set(SHARED.openKeys || []);
			const tiles = entries
				.filter((entry) => {
					const key = String(entry.options?.key ?? "");
					return !key.startsWith("ext:") && openKeys.has(key);
				})
				.map((entry) => {
				const key = entry.options?.key;
				const label = entry.options?.label || key;
				// Vertical tile: rotated label, or short badge.
				const short = String(label).slice(0, 2);
				return react.createElement("button", {
					key,
					title: label,
					onClick: () => {
						SHARED.activeKey = key;
						try { window.dispatchEvent(new Event("dsh-details-tabs-activate")); } catch { /* older browsers */ }
						openDetails();
					},
					style: {
						display: "block", width: 26, height: 44, margin: "4px 3px",
						border: "1px solid rgba(128,128,128,.3)", borderRadius: 6,
						background: "rgba(128,128,128,.12)", color: "inherit",
						fontSize: 11, cursor: "pointer",
						pointerEvents: "auto", // the rail container is pointer-events:none
					},
				}, short);
			});
			// Always render the rail (even with no panels) so the column can be
			// reopened — the rail is the single entry point when collapsed.
			const fallbackTile = tiles.length === 0
				? react.createElement("button", {
					key: "__open",
					title: t("panel.open"),
					onClick: openDetails,
					style: {
						display: "block", width: 26, height: 44, margin: "4px 3px",
						border: "1px solid rgba(128,128,128,.3)", borderRadius: 6,
						background: "rgba(128,128,128,.12)", color: "inherit",
						fontSize: 14, cursor: "pointer",
						pointerEvents: "auto", // the rail container is pointer-events:none
					},
				}, "≡")
				: null;
			const railContent = tiles.length > 0 ? tiles : [fallbackTile];
			return react.createElement("div", {
				style: {
					position: "absolute", right: 0, top: 0, bottom: 0, zIndex: 20,
					display: "flex", flexDirection: "column", alignItems: "center",
					justifyContent: "center", gap: 2,
					borderLeft: "1px solid rgba(128,128,128,.2)",
					background: "rgba(0,0,0,.03)",
					// The full-height rail must not swallow clicks meant for the
					// shell underneath (composer, send button). Only the tiles
					// re-enable pointer events.
					pointerEvents: "none",
				},
			}, railContent);
		}
		//#endregion

		//#region lib/types/client/mirror.js
		/**
		 * Third-party compatibility adapter.
		 *
		 * The native way for a plugin to appear in the right column is to
		 * register straight into the single `details` slot (that is what the
		 * official tool-call DetailsPanel does, and how dsh-artifacts-panel was
		 * documented before the container existed). A single slot renders only
		 * the lowest-priority entry, so every foreign `details` registration
		 * would otherwise be shadowed by this container — and, worse, one at
		 * priority < -1 would shadow the container itself.
		 *
		 * The mirror fixes both: for every foreign `details` entry it registers
		 * a twin into the container's own child slot `details.tabs.item` (same
		 * component + inject), so third-party panels appear as ordinary
		 * container panels — strip chip, layout leaf, draggable — with ZERO
		 * changes in their code. The container registers `details` at -10 so it
		 * always wins the single slot and mirrors whatever else arrives.
		 *
		 * Mirror rules:
		 *   - skip our own entry (component identity);
		 *   - derived key: entry.options.key ?? "ext:" + priority — live
		 *     single-slot priorities are unique (same priority would have
		 *     thrown at registration), so keys never collide and stay stable
		 *     across reloads (safe for the persisted layout);
		 *   - children tables are NOT copied: the original entry keeps
		 *     declaring them, re-declaring would throw "already declared";
		 *   - source = ctx.slots.entries("details"), re-synced on slot changes
		 *     plus a 2s interval (covers boot order — our own `details`
		 *     registration must declare details.tabs.item first; a failed
		 *     attempt is retried on the next tick).
		 */
		function mountThirdPartyMirror(ctx, selfComponent) {
			const mirrors = new Map(); // extKey -> { disposer, entry }
			let syncing = false;
			const fallbackLabel = () => {
				try {
					const lang = (navigator && navigator.language) || "";
					return /^zh/i.test(lang) ? "详情" : "Details";
				} catch { return "Details"; }
			};
			/**
			 * The official tool-call DetailsPanel (dsh-client-ui-conversation,
			 * locale NS "conversation"). It is the shell's NATIVE details
			 * content, not a third-party panel — mirroring it made a stray
			 * "Details"/"De" entry appear in the rail/chips/layout. The
			 * "conversation" NS belongs exclusively to the shell, so matching
			 * on it alone is both simpler and more robust than inspecting
			 * child-slot names (a future DSH could rename those).
			 */
			const isShellDetailsPanel = (entry) => (entry.options?.locale === "conversation");
			const sync = () => {
				if (syncing) return; // re-entrancy guard
				syncing = true;
				try {
					let list = [];
					try { list = ctx.slots.entries("details") || []; } catch { list = []; }
					const seen = new Set();
					for (const entry of list) {
						if (entry.component === selfComponent) continue; // ourselves
						if (isShellDetailsPanel(entry)) continue; // native shell panel
						// Uniform "ext:" prefix — every mirrored panel is
						// recognizable (and excluded from layout auto-add),
						// whether or not the source entry carried a key.
						const key = "ext:" + (entry.options?.key ?? String(entry.options?.priority ?? 0));
						seen.add(key);
						const existing = mirrors.get(key);
						if (existing !== undefined && existing.entry === entry) continue; // unchanged
						if (existing !== undefined) {
							try { existing.disposer(); } catch { /* ignore */ }
							mirrors.delete(key);
						}
						try {
							const disposer = ctx.slots.register({
								name: "details.tabs.item",
								key,
								label: entry.options?.label || entry.options?.key || fallbackLabel(),
								locale: entry.options?.locale,
								store: entry.options?.store,
								inject: entry.options?.inject,
							}, entry.component);
							mirrors.set(key, { disposer, entry });
						} catch (err) {
							// child slot not declared yet (boot order) or duplicate
							// key — retried on the next change / interval tick
						}
					}
					for (const [key, m] of mirrors) {
						if (!seen.has(key)) {
							try { m.disposer(); } catch { /* ignore */ }
							mirrors.delete(key);
						}
					}
				} finally {
					syncing = false;
				}
			};
			sync();
			const off = ctx.slots.subscribe("details", sync);
			const timer = setInterval(sync, 2000);
			return () => {
				clearInterval(timer);
				try { off(); } catch { /* ignore */ }
				for (const m of mirrors.values()) {
					try { m.disposer(); } catch { /* ignore */ }
				}
				mirrors.clear();
			};
		}
		//#endregion

		//#region lib/types/client/apply.js
		// Browser-side services: slots (dsh-client-ui-slots), locale, layout.
		const inject = ["slots", "locale", "layout"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-details-tabs: dictionaries");

			// priority -10 (not -1): a single slot renders the LOWEST priority,
			// so -1 could be shadowed by naive third-party panels registering at
			// -2 (or tie-throw against another -1). -10 wins over the official
			// tool-call DetailsPanel (0) and the usual -1/-2 community band; the
			// mirror adapter below turns every such registration into a panel.
			ctx.slots.inject("details", () => ctx.slots.register({
				name: "details",
				priority: -10,
				locale: NS,
				inject: () => ({
					closeDetails: () => ctx.layout.closeDetails(),
					tabEntries: () => ctx.slots.entries("details.tabs.item"),
				}),
				children: { "details.tabs.item": { kind: "keyed", scope: "session" } },
			}, TabsContainer));

			// Third-party compatibility: mirror every foreign `details`
			// registration into our child slot so it shows up as a panel.
			ctx.effect(() => mountThirdPartyMirror(ctx, TabsContainer), "dsh-details-tabs: third-party details mirror");

			// Blender-style dock rail along the right edge while collapsed:
			// the single entry point for reopening the column (no separate
			// bottom-right trigger — the rail lists every panel already).
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-details-tabs-dock",
				locale: NS,
				inject: () => ({
					openDetails: () => ctx.layout.openDetails(),
					tabEntries: () => ctx.slots.entries("details.tabs.item"),
				}),
			}, DockRail));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.TabsContainer = TabsContainer;
		exports.DockRail = DockRail;
		exports.applyOrder = applyOrder;
		exports.readOrder = readOrder;
		exports.writeOrder = writeOrder;
		exports.readLayout = readLayout;
		exports.persistLayout = persistLayout;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
