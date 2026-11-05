// 错误日志插件 —— Client 半边（浏览器运行）
//
// 自注册包格式：window.__ModuleLoader__.load({ id, factory })。
// factory 内用 require(...) 加载共享模块（react 等），最后 return module.exports。
// 注册两类插槽：
//   - sidebar.panellist：左侧栏入口图标（id = PANEL_ID）
//   - main：点击图标后主区域显示的页面（key = PANEL_ID）
window.__ModuleLoader__.load({
	id: "dsh-plugin-error-logs",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const { useState, useEffect, useCallback } = React;

		const PANEL_ID = "error-logs";
		const NS = "errorLogs";
		const API = "/x-error-logs";
		const inject = ["slots", "locale"];

		// 主题 token（带兜底）
		const T = {
			bg: "var(--dsw-alias-bg-base, #fff)",
			layer1: "var(--dsw-alias-bg-layer-1, #fafafa)",
			layer2: "var(--dsw-alias-bg-layer-2, #f3f4f6)",
			b1: "var(--dsw-alias-border-l1, rgba(0,0,0,0.06))",
			b2: "var(--dsw-alias-border-l2, rgba(0,0,0,0.12))",
			t1: "var(--dsw-alias-label-primary, #111827)",
			t2: "var(--dsw-alias-label-secondary, #4b5563)",
			t3: "var(--dsw-alias-label-tertiary, #9ca3af)",
			brand: "var(--dsw-alias-brand-primary, #2563eb)",
			success: "var(--dsw-alias-state-success-primary, #16a34a)",
			error: "var(--dsw-alias-state-error-primary, #dc2626)",
			warn: "var(--dsw-alias-state-warn-label, #d97706)",
			hover: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04))",
			r6: "var(--dsw-radius-sm, 8px)",
			r8: "var(--dsw-radius-md, 12px)",
			s1: "var(--dsw-shadow-lv1, 0 1px 3px rgba(0,0,0,0.08))",
			mono: "var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)"
		};

		// 一次性注入 CSS（滚动条/hover/按钮态）
		const styleId = "eld-style";
		if (typeof document !== "undefined" && !document.getElementById(styleId)) {
			const st = document.createElement("style");
			st.id = styleId;
			st.textContent = [
				".eld-scroll::-webkit-scrollbar{width:9px;height:9px}",
				".eld-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:6px}",
				".eld-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111827);transition:background .12s,border-color .12s}",
				".eld-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}",
				".eld-btn:disabled{opacity:.55;cursor:not-allowed}",
				".eld-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}",
				".eld-spin{animation:eldrot .9s linear infinite;display:inline-block}",
				"@keyframes eldrot{to{transform:rotate(360deg)}}"
			].join("\n");
			document.head.appendChild(st);
		}

		function Icon({ name, size }) {
			const s = typeof size === "number" ? size : 18;
			const p = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
			const paths = {
				refresh: [
					h("path", { key: "a", d: "M21 12a9 9 0 1 1-2.64-6.36" }),
					h("path", { key: "b", d: "M21 3v6h-6" })
				],
				alert: [
					h("path", { key: "a", d: "M12 3l9 16H3z" }),
					h("path", { key: "b", d: "M12 9v5M12 17h.01" })
				],
				search: [
					h("circle", { key: "a", cx: 11, cy: 11, r: 7 }),
					h("path", { key: "b", d: "M21 21l-4.3-4.3" })
				],
				copy: [
					h("rect", { key: "a", x: 9, y: 9, width: 11, height: 11, rx: 2 }),
					h("path", { key: "b", d: "M5 15V5a2 2 0 0 1 2-2h10" })
				]
			};
			return h("svg", p, paths[name] || null);
		}

		function SidebarIcon({ size }) {
			const s = typeof size === "number" ? size : 20;
			return h("svg", { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
				h("path", { d: "M4 4h16v16H4z" }),
				h("path", { d: "M8 9h8M8 13h8M8 17h5" }),
				h("circle", { cx: 17.5, cy: 7, r: 1.3, fill: "currentColor", stroke: "none" })
			);
		}

		const S = {
			page: { height: "100%", display: "flex", flexDirection: "column", background: T.bg, color: T.t1 },
			header: { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${T.b1}`, background: T.layer1 },
			title: { fontSize: 15, fontWeight: 650, display: "flex", alignItems: "center", gap: 8 },
			badge: { fontSize: 11, padding: "1px 7px", borderRadius: 10, background: "rgba(220,38,38,.1)", color: T.error, fontWeight: 600 },
			toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${T.b1}`, background: T.bg },
			spacer: { flex: 1 },
			select: { height: 32, borderRadius: T.r6, border: `1px solid ${T.b2}`, background: T.bg, color: T.t1, padding: "0 8px", fontSize: 13 },
			input: { height: 32, borderRadius: T.r6, border: `1px solid ${T.b2}`, background: T.bg, color: T.t1, padding: "0 10px", fontSize: 13, width: 220 },
			btn: (disabled) => ({ height: 32, borderRadius: T.r6, padding: "0 12px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 550 }),
			body: { flex: 1, overflow: "auto", padding: 8 },
			row: { padding: "8px 10px", borderBottom: `1px solid ${T.b1}`, borderRadius: 6, display: "flex", flexDirection: "column", gap: 3 },
			rowHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: T.t3 },
			app: { fontWeight: 600, color: T.brand, fontSize: 11, padding: "0 6px", borderRadius: 8, background: "rgba(37,99,235,.1)" },
			line: { fontFamily: T.mono, fontSize: 12, color: T.t1, whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.5 },
			empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: T.t3, gap: 10, fontSize: 13 },
			err: { margin: 16, padding: 12, borderRadius: T.r8, background: "rgba(220,38,38,.08)", color: T.error, fontSize: 13, border: `1px solid rgba(220,38,38,.2)` }
		};

		function fmtTime(iso) {
			try {
				const d = new Date(iso);
				const pad = (n) => String(n).padStart(2, "0");
				return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
			} catch (e) {
				return iso;
			}
		}

		const WINDOWS = [
			{ label: "最近 15 分钟", seconds: 900 },
			{ label: "最近 1 小时", seconds: 3600 },
			{ label: "最近 6 小时", seconds: 21600 },
			{ label: "最近 24 小时", seconds: 86400 }
		];

		function ErrorLogsPage() {
			const [meta, setMeta] = useState(null);
			const [apps, setApps] = useState([]);
			const [app, setApp] = useState("");
			const [win, setWin] = useState(3600);
			const [limit, setLimit] = useState(200);
			const [rows, setRows] = useState([]);
			const [loading, setLoading] = useState(false);
			const [error, setError] = useState("");
			const [logql, setLogql] = useState("");
			const [fetchedAt, setFetchedAt] = useState("");
			const [filter, setFilter] = useState("");

			const load = useCallback(async (silent) => {
				if (!silent) setLoading(true);
				setError("");
				try {
					const params = new URLSearchParams();
					if (app) params.set("app", app);
					params.set("windowSeconds", String(win));
					params.set("limit", String(limit));
					const resp = await fetch(`${API}/query?${params.toString()}`, { headers: { accept: "application/json" } });
					const data = await resp.json();
					if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
					setRows(data.rows || []);
					setLogql(data.logql || "");
					setFetchedAt(data.fetchedAt || "");
				} catch (e) {
					setError(String((e && e.message) || e));
					setRows([]);
				} finally {
					setLoading(false);
				}
			}, [app, win, limit]);

			useEffect(() => {
				let alive = true;
				(async () => {
					try {
						const resp = await fetch(`${API}/meta`, { headers: { accept: "application/json" } });
						const data = await resp.json();
						if (!alive) return;
						setMeta(data);
						setApps(Array.isArray(data.apps) ? data.apps : []);
						if (data.error) setError(data.error);
					} catch (e) {
						if (alive) setError(`无法连接插件后端：${String((e && e.message) || e)}`);
					}
				})();
				return () => { alive = false; };
			}, []);

			useEffect(() => { load(); }, [load]);

			const shown = filter.trim()
				? rows.filter((r) => r.line.toLowerCase().includes(filter.trim().toLowerCase()))
				: rows;

			const copyAll = () => {
				const text = shown.map((r) => `[${fmtTime(r.time)}] ${r.app} ${r.line}`).join("\n");
				if (navigator.clipboard) navigator.clipboard.writeText(text);
			};

			return h("div", { style: S.page },
				h("div", { style: S.header },
					h("span", { style: { color: T.error, display: "flex" } }, h(Icon, { name: "alert", size: 18 })),
					h("span", { style: S.title }, "错误日志",
						h("span", { style: S.badge }, shown.length)
					),
					h("span", { style: S.spacer }),
					meta && meta.health
						? h("span", { style: { fontSize: 11, color: T.success, display: "flex", alignItems: "center", gap: 5 } },
							h("span", { style: { width: 7, height: 7, borderRadius: "50%", background: T.success, display: "inline-block" } }),
							"Loki 已连接" + (meta.health.version ? ` · Grafana ${meta.health.version}` : ""))
						: null
				),
				h("div", { style: S.toolbar },
					h("select", { className: "eld-btn", style: S.select, value: app, onChange: (e) => setApp(e.target.value) },
						h("option", { value: "" }, "全部应用"),
						apps.map((a) => h("option", { key: a, value: a }, a))
					),
					h("select", { className: "eld-btn", style: S.select, value: win, onChange: (e) => setWin(Number(e.target.value)) },
						WINDOWS.map((w) => h("option", { key: w.seconds, value: w.seconds }, w.label))
					),
					h("select", { className: "eld-btn", style: S.select, value: limit, onChange: (e) => setLimit(Number(e.target.value)) },
						[50, 100, 200, 500].map((n) => h("option", { key: n, value: n }, `最多 ${n} 条`))
					),
					h("input", { className: "eld-btn", style: S.input, placeholder: "在结果中筛选关键字…", value: filter, onChange: (e) => setFilter(e.target.value) }),
					h("span", { style: S.spacer }),
					h("button", { className: "eld-btn", style: S.btn(loading), onClick: () => load(), disabled: loading, title: "刷新" },
						h("span", { className: loading ? "eld-spin" : "", style: { display: "flex" } }, h(Icon, { name: "refresh", size: 15 })),
						loading ? "查询中" : "刷新"
					),
					h("button", { className: "eld-btn", style: S.btn(shown.length === 0), onClick: copyAll, disabled: shown.length === 0, title: "复制现有结果" },
						h(Icon, { name: "copy", size: 15 }), "复制"
					)
				),
				error ? h("div", { style: S.err }, "⚠ " + error) : null,
				h("div", { style: S.body, className: "eld-scroll" },
					shown.length === 0 && !loading && !error
						? h("div", { style: S.empty },
							h(Icon, { name: "search", size: 30 }),
							h("div", null, "所选范围内没有匹配的错误日志"),
							logql ? h("div", { style: { fontSize: 11, fontFamily: T.mono, color: T.t3 } }, logql) : null
						)
						: null,
					shown.map((r, i) =>
						h("div", { key: i, style: S.row, className: "eld-row" },
							h("div", { style: S.rowHead },
								r.app ? h("span", { style: S.app }, r.app) : null,
								h("span", null, fmtTime(r.time))
							),
							h("div", { style: S.line }, r.line)
						)
					)
				),
				fetchedAt
					? h("div", { style: { padding: "6px 16px", borderTop: `1px solid ${T.b1}`, fontSize: 11, color: T.t3, display: "flex", justifyContent: "space-between" } },
						h("span", { style: { fontFamily: T.mono } }, logql || ""),
						h("span", null, "更新于 " + fmtTime(fetchedAt)))
					: null
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh: { panel: "错误日志", title: "错误日志" },
				en: { panel: "Error Logs", title: "Error Logs" }
			}), "error-logs:dictionaries");
			const t = ctx.locale.bind(NS);

			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS
			}, ErrorLogsPage));

			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 21,
				locale: NS,
				label: () => t("panel")
			}, SidebarIcon));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
