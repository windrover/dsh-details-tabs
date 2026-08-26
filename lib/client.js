/**
 * dsh-details-tabs — Browser half.
 *
 * Owns the single `details` slot (priority -1) and renders it as a tabbed
 * container. Panels register into the keyed child slot `details.tabs.item`
 * (key = panel id, options.label = tab title); the container renders the tab
 * bar plus the active panel via the renderSlot binding.
 *
 * Also owns the window chrome for the details column:
 *   - a bottom-right trigger (`shell.overlay`) to reopen the column;
 *   - a Blender-style vertical dock rail along the right edge when the
 *     column is collapsed, listing every registered panel for one-click open.
 *   - draggable tabs (HTML5 DnD) to reorder panels; order persists in
 *     localStorage per workspace.
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
		};
		const en = {
			"panel.close": "Close",
			"panel.empty": "(no panels)",
			"panel.open": "Windows",
		};
		//#endregion

		//#region lib/types/client/order.js
		/** localStorage key for the tab order (per browser origin). */
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

		//#region lib/types/client/TabsContainer.js
		/**
		 * The tabbed details column. `tabEntries()` lists the registered child
		 * panels (key + label); the active panel renders via `renderSlot`.
		 * Tabs are HTML5-draggable to reorder; the order persists.
		 * @param props - { t, renderSlot, tabEntries, closeDetails }
		 */
		function TabsContainer(props) {
			const { t, renderSlot, tabEntries, closeDetails } = props;
			const [activeKey, setActiveKeyState] = react.useState(SHARED.activeKey);
			const [entries, setEntries] = react.useState([]);
			const [dragKey, setDragKey] = react.useState(null);

			const setActiveKey = react.useCallback((key) => {
				SHARED.activeKey = key;
				setActiveKeyState(key);
			}, []);

			const refresh = react.useCallback(() => {
				let list = [];
				try { list = (tabEntries ? tabEntries() : []) || []; } catch { list = []; }
				setEntries(applyOrder(list));
				setActiveKeyState((current) => {
					if (current !== null && list.some((e) => e.options?.key === current)) return current;
					const fallback = list[0]?.options?.key ?? null;
					SHARED.activeKey = fallback;
					return fallback;
				});
			}, [tabEntries]);

			react.useEffect(() => {
				refresh();
				const timer = setInterval(refresh, 2000);
				// Listen for dock-rail activation (DockRail writes SHARED.activeKey
				// and dispatches this event).
				const onActivate = () => {
					if (SHARED.activeKey !== null) setActiveKeyState(SHARED.activeKey);
				};
				window.addEventListener("dsh-details-tabs-activate", onActivate);
				return () => { clearInterval(timer); window.removeEventListener("dsh-details-tabs-activate", onActivate); };
			}, [refresh]);

			const onDrop = (targetKey) => {
				if (dragKey === null || dragKey === targetKey) { setDragKey(null); return; }
				setEntries((prev) => {
					const next = prev.slice();
					const from = next.findIndex((e) => e.options?.key === dragKey);
					const to = next.findIndex((e) => e.options?.key === targetKey);
					if (from < 0 || to < 0) return prev;
					const [moved] = next.splice(from, 1);
					next.splice(to, 0, moved);
					writeOrder(next.map((e) => e.options?.key));
					return next;
				});
				setDragKey(null);
			};

			const tabBar = entries.map((entry) => {
				const key = entry.options?.key;
				const label = entry.options?.label || key;
				const active = key === activeKey;
				return react.createElement("button", {
					key,
					draggable: true,
					onDragStart: () => setDragKey(key),
					onDragOver: (e) => e.preventDefault(),
					onDrop: () => onDrop(key),
					onClick: () => setActiveKey(key),
					style: {
						flex: 1,
						padding: "6px 4px",
						fontSize: 12,
						border: "none",
						borderBottom: active ? "2px solid rgba(60,140,255,.8)" : "2px solid transparent",
						background: "transparent",
						color: active ? "inherit" : "rgba(128,128,128,.7)",
						cursor: "grab",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					},
				}, label);
			});

			let content = null;
			if (activeKey !== null) {
				try {
					content = renderSlot("details.tabs.item", {}, { entryKey: activeKey });
				} catch (e) {
					content = react.createElement("div", { style: { opacity: .6 } }, String(e?.message || e));
				}
			} else {
				content = react.createElement("div", { style: { opacity: .6, padding: 10 } }, t("panel.empty"));
			}

			return react.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
				react.createElement("div", { style: { display: "flex", borderBottom: "1px solid rgba(128,128,128,.2)", alignItems: "center" } },
					tabBar,
					typeof closeDetails === "function" && react.createElement("button", {
						onClick: closeDetails,
						title: t("panel.close"),
						style: { padding: "4px 8px", border: "none", background: "transparent", cursor: "pointer", color: "inherit" },
					}, "✕"),
				),
				react.createElement("div", { style: { flex: 1, overflow: "hidden" } }, content),
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
		 * Bottom-right trigger (shown while the details column is closed):
		 * opens the column. Label "窗口" (Windows).
		 */
		function WindowTrigger({ openDetails, t }) {
			const open = useDetailsOpen();
			if (open) return null;
			return react.createElement("button", {
				onClick: openDetails,
				title: t("panel.open"),
				style: {
					position: "absolute", right: 0, bottom: 0, zIndex: 30,
					height: 30, padding: "0 14px", border: "none",
					borderTop: "1px solid rgba(128,128,128,.3)", borderLeft: "1px solid rgba(128,128,128,.3)",
					borderRadius: "10px 0 0 0",
					background: "var(--dsw-alias-bg-base, rgba(255,255,255,.85))",
					color: "var(--dsw-alias-label-secondary, #555)",
					fontSize: 12, cursor: "pointer",
				},
			}, t("panel.open"));
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
		exports.WindowTrigger = WindowTrigger;
		exports.DockRail = DockRail;
		exports.applyOrder = applyOrder;
		exports.readOrder = readOrder;
		exports.writeOrder = writeOrder;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
