// 错误日志插件 —— Host 半边（Node 侧运行）
//
// 职责：
//   在 webServer 上注册 /x-error-logs/* 路由，转发到 Grafana Loki 的 HTTP API，
//   查询「当前最新的错误日志」。浏览器只与同源路由通信，Grafana token 绝不下发前端。
//
// 提供接口：
//   GET /x-error-logs/query?app=&since=&limit=&query=
//     返回按时间倒序的一段最新错误日志（原始行 + 标签 + 时间戳）。
//   GET /x-error-logs/meta
//     返回可用的 app 取值列表、默认时间窗口、Loki 数据源 uid、连通性。
//
// Cordis 插件约定：导出 name / inject / apply。

const name = "error-logs";

/** 依赖 Host 服务：webServer（注册 HTTP 路由）、connection（浏览器信任栅栏）。 */
const inject = ["webServer", "connection"];

const ROUTE_PREFIX = "/x-error-logs";
const GRAFANA_TIMEOUT_MS = 20 * 1000;

/** 默认错误匹配正则：命中日志级别标记与常见异常关键字，避免误抓 SQL 里出现的列名。 */
const DEFAULT_ERROR_FILTER = '\\b(ERROR|FATAL|Exception|Caused by|panic|Traceback|SEVERE)\\b';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

/** 把 "now-1h" / 秒数 / RFC3339 转成 epoch 纳秒（Loki 需要纳秒）。 */
function toEpochNs(value, fallbackSeconds) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value * 1e9);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const s = value.trim();
    // now / now-<n><unit>
    const m = /^now((?:-(\d+)([smhd]))?)$/.exec(s);
    if (m) {
      let seconds = 0;
      if (m[2]) {
        const n = Number(m[2]);
        const unit = m[3];
        const mult = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
        seconds = n * mult;
      }
      return Math.trunc(Date.now() - seconds * 1000) * 1e6;
    }
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return Math.trunc(t) * 1e6;
  }
  return Math.trunc(Date.now() - (fallbackSeconds || 3600) * 1000) * 1e6;
}

/** 统一 fetch Grafana，带 Bearer token、超时与 JSON 解析。 */
async function grafanaFetch(cfg, path, params) {
  const url = new URL(path, cfg.url.replace(/\/+$/, "") + "/");
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || GRAFANA_TIMEOUT_MS);
  try {
    const headers = { accept: "application/json" };
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
    const resp = await fetch(url, { headers, signal: controller.signal });
    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** 若未配置 datasourceUid，自动发现第一个 loki 类型数据源。 */
async function resolveLokiUid(cfg) {
  if (cfg.datasourceUid) return cfg.datasourceUid;
  const { status, data } = await grafanaFetch(cfg, "/api/datasources");
  if (status !== 200 || !Array.isArray(data)) {
    throw new Error(`无法列出数据源（HTTP ${status}）`);
  }
  const loki = data.find((d) => String(d.type || "").toLowerCase().includes("loki"));
  if (!loki) throw new Error("未找到 Loki 数据源，请在插件配置中指定 datasourceUid");
  return loki.uid;
}

/** 列出某标签的取值（用于 app 下拉）。 */
async function listLabelValues(cfg, uid, label) {
  const { status, data } = await grafanaFetch(
    cfg,
    `/api/datasources/proxy/uid/${encodeURIComponent(uid)}/loki/api/v1/label/${encodeURIComponent(label)}/values`
  );
  if (status !== 200) return [];
  const items = Array.isArray(data) ? data : Array.isArray(data && data.data) ? data.data : [];
  return items;
}

/** 查询最近错误日志（query_range，backward，最新优先）。 */
async function queryErrorLogs(cfg, opts) {
  const uid = await resolveLokiUid(cfg);
  const windowSeconds = opts.windowSeconds && opts.windowSeconds > 0 ? opts.windowSeconds : cfg.windowSeconds || 3600;
  const limit = Math.min(Math.max(opts.limit || cfg.limit || 200, 1), 500);

  // 构造 LogQL：流选择器 + 错误过滤。
  // 若给了 app，则按 app 过滤；否则扫整个 job（若配了 baseSelector）。
  const selectorParts = [];
  if (opts.app) selectorParts.push(`app="${String(opts.app).replace(/"/g, '\\"')}"`);
  if (cfg.baseSelector) selectorParts.push(cfg.baseSelector);
  const streamSel = selectorParts.length ? `{${selectorParts.join(", ")}}` : cfg.defaultStreamSelector || '{job=~".+"}';

  const filter = opts.query && opts.query.trim() !== "" ? opts.query.trim() : DEFAULT_ERROR_FILTER;
  // 用 |~ 正则过滤（filter 若是完整 logql 段则原样拼接）。
  let logql;
  if (/^\s*\{/.test(filter)) {
    // 用户直接给了完整 selector/表达式
    logql = filter;
  } else if (/^\s*\|/.test(filter)) {
    logql = `${streamSel} ${filter}`;
  } else {
    logql = `${streamSel} |~ ${JSON.stringify(filter)}`;
  }

  const startNs = toEpochNs(opts.since, windowSeconds);
  const endNs = Math.trunc(Date.now()) * 1e6;

  const params = {
    query: logql,
    limit: String(limit),
    direction: "backward",
    start: String(startNs),
    end: String(endNs),
  };
  const { status, data } = await grafanaFetch(
    cfg,
    `/api/datasources/proxy/uid/${encodeURIComponent(uid)}/loki/api/v1/query_range`,
    params
  );
  if (status !== 200) {
    throw new Error(`Loki 查询失败（HTTP ${status}）: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  }
  const streams = (data && data.data && data.data.result) || [];
  const rows = [];
  for (const stream of streams) {
    const labels = stream.stream || {};
    for (const [tsNs, line] of stream.values || []) {
      // tsNs 是字符串纳秒
      const ms = Math.floor(Number(tsNs) / 1e6);
      rows.push({ ts: ms, time: new Date(ms).toISOString(), app: labels.app || "", labels, line });
    }
  }
  rows.sort((a, b) => b.ts - a.ts);
  return { logql, rows: rows.slice(0, limit), total: rows.length, uid };
}

function apply(ctx, config = {}) {
  const cfg = {
    url: config.url || config.grafanaUrl || "",
    token: config.token || "",
    timeoutMs: config.timeoutMs || GRAFANA_TIMEOUT_MS,
    datasourceUid: config.datasourceUid || "",
    baseSelector: config.baseSelector || "",
    defaultStreamSelector: config.defaultStreamSelector || "",
    windowSeconds: config.windowSeconds || 3600,
    limit: config.limit || 200,
  };

  const connectionOf = () => Reflect.get(ctx, "connection");
  const rejected = (req, res) => {
    const connection = connectionOf();
    const rejection = connection && connection.requestRejection ? connection.requestRejection(req) : undefined;
    if (rejection === void 0) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  const route = (method, handler) => async (req, res) => {
    if (rejected(req, res)) return;
    if (req.method !== method) {
      res.statusCode = 405;
      res.setHeader("allow", method);
      res.end();
      return;
    }
    if (!cfg.url) {
      sendJson(res, 503, { error: "插件未配置 Grafana 地址（url）" });
      return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      sendJson(res, 502, { error: String((error && error.message) || error) });
    }
  };

  // 1) 元信息：app 列表 + 默认参数 + 连通性
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: `${ROUTE_PREFIX}/meta`,
        handler: route("GET", async (req, res) => {
          let apps = [];
          let health = null;
          let error = null;
          try {
            const h = await grafanaFetch(cfg, "/api/health");
            health = { status: h.status, version: h.data && h.data.version };
            const uid = await resolveLokiUid(cfg);
            apps = await listLabelValues(cfg, uid, "app");
          } catch (e) {
            error = String((e && e.message) || e);
          }
          sendJson(res, 200, {
            apps,
            windowSeconds: cfg.windowSeconds,
            limit: cfg.limit,
            datasourceUid: cfg.datasourceUid,
            health,
            error,
          });
        }),
      }),
    "error-logs: /meta"
  );

  // 2) 查询最新错误日志
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: `${ROUTE_PREFIX}/query`,
        handler: route("GET", async (req, res) => {
          const u = new URL(req.url, "http://localhost");
          const opts = {
            app: u.searchParams.get("app") || "",
            since: u.searchParams.get("since") || "",
            limit: Number(u.searchParams.get("limit")) || 0,
            query: u.searchParams.get("query") || "",
            windowSeconds: Number(u.searchParams.get("windowSeconds")) || 0,
          };
          const result = await queryErrorLogs(cfg, opts);
          sendJson(res, 200, {
            ok: true,
            logql: result.logql,
            total: result.total,
            count: result.rows.length,
            datasourceUid: result.uid,
            rows: result.rows,
            fetchedAt: new Date().toISOString(),
          });
        }),
      }),
    "error-logs: /query"
  );
}

export { name, inject, apply };
