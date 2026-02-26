# autoproxy

`autoproxy` 是一个基于 Node.js 的本地 HTTPS 代理中继服务。

它会从 `https://free-proxy-list.net/en/` 抓取公开代理，只保留同时满足
`Google = yes` 和 `Https = yes` 的条目，并将收到的 `CONNECT` 请求转发到筛选后的上游代理池。

English version: [README.md](README.md)

> ⚠️ **仅供学习与研究使用**
>
> 本项目仅作为学习示例与技术演示之用。公开免费代理天然存在不可信风险——这些服务器由不明第三方运营，可能随时不稳定、注入恶意内容、拦截流量或突然下线。**请勿将本项目用于处理任何敏感数据、登录凭证或生产环境流量。**
>
> 如需在实际业务中使用代理，请自行购买正规可信的商业代理服务。
>
> **本项目作者对因使用本软件而直接或间接导致的任何损失、安全事故、法律问题或其他后果，不承担任何责任。**

## 功能特性

- 自动从 `free-proxy-list.net/en/` 抓取代理列表
- 过滤条件：
  - `Google = yes`
  - `Https = yes`
- 固定间隔自动刷新代理池
- 默认在本地 `2319` 端口监听
- 支持 `CONNECT` 的 HTTPS 隧道转发，失败时自动尝试下一个上游代理

## 工作原理

1. 服务启动后会立即抓取并解析代理表格 HTML。
2. 提取符合过滤规则的 `IP:Port`，并进行去重。
3. 在本地端口监听代理客户端连接。
4. 对每个 `CONNECT host:port` 请求，按轮询候选顺序尝试上游代理。
5. 第一个返回 `HTTP 200` 的上游代理会被用于建立双向透传隧道。
6. 后台定时任务持续刷新代理池，使源站列表变化可以自动生效。

## 项目结构

```text
.
|- index.js
|- package.json
|- README.md
|- README.zh-CN.md
`- LICENSE
```

## 环境要求

- Node.js 18+（推荐 LTS）

## 安装与启动

```bash
npm install
npm start
```

也可以直接运行：

```bash
node index.js
```

默认监听地址：

```text
0.0.0.0:2319
```

## 配置项

以下环境变量可选：

- `PORT`: 本地监听端口，默认 `2319`
- `REFRESH_INTERVAL_MS`: 代理刷新周期（毫秒），默认 `60000`
- `MIN_REFRESH_GAP_MS`: 最小刷新间隔保护（毫秒），默认 `15000`
- `CONNECT_TIMEOUT_MS`: 上游连接超时（毫秒），默认 `10000`

PowerShell 示例：

```powershell
$env:PORT=2319
$env:REFRESH_INTERVAL_MS=45000
$env:CONNECT_TIMEOUT_MS=8000
node index.js
```

## 使用方式

将你的程序 HTTPS 代理指向 `127.0.0.1:2319`。

`curl` 示例：

```bash
curl -x http://127.0.0.1:2319 https://www.google.com -I
```

注意事项：

- 当前只实现了 `CONNECT` 的 HTTPS 隧道。
- 普通 HTTP 代理请求未实现，会返回 `405`。

## 日志说明

常见日志类型：

- 刷新日志：
  - `[refresh] ... loaded N proxies`
  - `[refresh] ... failed: <reason>`
- 转发日志：
  - `[connect] targetHost:targetPort via proxyHost:proxyPort`

这些日志可用于判断代理池是否正常更新，以及请求是否经由上游代理成功转发。

## 故障排查

1. 刷新失败（如 `EACCES`、`ETIMEDOUT`）
   - 通常表示当前运行环境网络受限，无法访问源站。
2. `Proxy pool is empty`
   - 可能是没有符合条件的条目，或源站 HTML 结构变化导致解析失败。
3. `502 Bad Gateway`
   - 当前候选上游代理全部连接失败，可等待下一轮刷新后重试。

## 安全说明与免责声明

- **公开免费代理天然存在稳定性与安全风险。** 它们由不明第三方运营，随时可能监听、篡改或丢弃你的流量。
- **本项目仅供学习使用，** 请勿承载任何敏感数据、个人隐私或生产关键流量。
- **如需在生产环境使用代理，** 请自行购买正规商业代理服务，而非依赖公开免费代理。
- **本项目作者不对因使用本软件所导致的任何损失、数据泄露、安全事故或法律责任承担赔偿或连带责任，** 使用者需自行承担全部风险。
- 请确保使用方式符合适用法律法规及目标站点的服务条款。

## 许可证

本项目采用 MIT License，详见 `LICENSE`。
