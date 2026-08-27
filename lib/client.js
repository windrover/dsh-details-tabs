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
			"panel.drag": "拖拽面板标题到另一面板上：左右/上下=并排，中间=替换",
		};
		const en = {
			"panel.close": "Close",
			"panel.empty": "(no panels)",
			"panel.open": "Windows",
			"panel.collapse": "Collapse",
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
				next = next === null || next === undefined ? leaf(key) : split('row', next, leaf(key));
			}
			return next;
		}
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
					const next = addPanels(prev, keys);
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

			const labelOf = react.useCallback((key) => {
				for (const e of entries) { if (e.options?.key === key) return e.options?.label || key; }
				return key;
			}, [entries]);

			// ── layout mutations: user-interaction handlers only ────────────────
			const closePanelHandler = (panel) => {
				setLayout((prev) => {
					const next = closePanel(prev, panel);
					if (next === prev) return prev;
					if (next === null) { persistLayout(EMPTY); return EMPTY; } // all closed
					persistLayout(next);
					return next;
				});
			};

			const reopenPanel = (panel) => {
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
				const aFlex = isRow
					? { flex: `0 0 calc(${node.ratio * 100}% - 2.5px)`, minWidth: 0 }
					: { flex: `0 0 calc(${node.ratio * 100}% - 2.5px)`, minHeight: 0 };
				const bFlex = isRow ? { flex: "1 1 0%", minWidth: 0 } : { flex: "1 1 0%", minHeight: 0 };
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

			// ── strip: every registered panel (open = highlighted, click reopens) ─
			const stripChips = entries.map((entry) => {
				const key = entry.options?.key;
				const label = entry.options?.label || key;
				const open = key !== undefined && hasPanel(layout, key);
				return react.createElement("button", {
					key,
					title: label,
					onClick: () => { if (!open) reopenPanel(key); },
					style: {
						flex: "0 0 auto", padding: "3px 8px", fontSize: 11,
						border: "1px solid " + (open ? "rgba(60,140,255,.55)" : "rgba(128,128,128,.25)"),
						borderRadius: 10, background: open ? "rgba(60,140,255,.10)" : "transparent",
						color: open ? "inherit" : "rgba(128,128,128,.6)",
						cursor: "pointer", whiteSpace: "nowrap",
					},
				}, label);
			});

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
			const tiles = entries.map((entry) => {
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

		//#region lib/types/client/apply.js
		// Browser-side services: slots (dsh-client-ui-slots), locale, layout.
		const inject = ["slots", "locale", "layout"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-details-tabs: dictionaries");

			ctx.slots.inject("details", () => ctx.slots.register({
				name: "details",
				priority: -1,
				locale: NS,
				inject: () => ({
					closeDetails: () => ctx.layout.closeDetails(),
					tabEntries: () => ctx.slots.entries("details.tabs.item"),
				}),
				children: { "details.tabs.item": { kind: "keyed", scope: "session" } },
			}, TabsContainer));

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
