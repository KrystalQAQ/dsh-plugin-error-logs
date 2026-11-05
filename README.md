# dsh-plugin-error-logs（错误日志）

DSH Web 客户端插件：在左侧栏新增「错误日志」入口，集中查看 Grafana / Loki 里当前最新的错误日志（按 app、时间范围筛选）。

## 功能

- **左侧栏入口**：侧栏出现「错误日志」图标，点击打开主面板页面。
- **只看错误**：默认 LogQL 过滤器 `\b(ERROR|FATAL|Exception|Caused by|panic|Traceback|SEVERE)\b`，避免误抓 SQL 里出现的列名；也可输入自定义查询。
- **app 筛选**：自动列出 Loki 里 `app` 标签的全部取值，选一个即只看该应用。
- **时间窗口**：`now-15m` / `now-1h` / `now-6h` / `now-24h` 等，快捷切换。
- **原始行展示**：时间戳 + app + 日志原文（等宽字体），命中关键字高亮，一键复制。
- **凭据安全**：Grafana 地址与 Token 只存在于服务端配置，浏览器只与同源路由通信，**Token 永不下发前端**。

## 安装

```bash
dsh plugin add /path/to/dsh-plugin-error-logs
```

或在本仓库目录下执行 `dsh plugin add .`。

随后在 profile 的 `cordis.patch.yml`（或本包的 `cordis.patch.yml`）里填上自己的 Grafana 配置：

```yaml
- insert:
    - id: error-logs
      name: 'dsh-plugin-error-logs'
      config:
        url: https://grafana.example.com        # Grafana 基地址
        token: ''                               # 服务账号 Token（Bearer）
        datasourceUid: ''                       # Loki 数据源 uid；留空则自动发现第一个 loki 数据源
        windowSeconds: 3600                     # 默认时间窗口（秒）
        limit: 200                              # 默认返回条数
```

> Token 属于私密凭据，请勿提交到仓库。仓库里的 `cordis.patch.yml` 只是模板，不含真实地址与 Token。

## 宿主接口

| 路由 | 说明 |
|---|---|
| `GET /x-error-logs/meta` | 返回 app 取值列表、默认时间窗口、Loki 数据源 uid、Grafana 连通性 |
| `GET /x-error-logs/query` | 查询错误日志：`app`、`since`（`now-1h` / 秒 / RFC3339）、`limit`、`query`（自定义 LogQL 选择器） |

返回体按时间倒序，字段：`ts`（毫秒）、`time`（ISO）、`app`、`labels`、`line`。

## 视觉

界面沿用 DSH 主题 token（`--dsw-alias-*` / `--dsw-radius-*`），自动适配浅色/深色主题。

## 许可

MIT
