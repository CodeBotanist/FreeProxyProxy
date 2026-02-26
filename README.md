# autoproxy

`autoproxy` is a local HTTPS proxy relay written in Node.js.

中文文档: [README.zh-CN.md](README.zh-CN.md)

It fetches public proxies from `https://free-proxy-list.net/en/`, keeps only
entries where both `Google = yes` and `Https = yes`, and forwards incoming
`CONNECT` requests to the filtered upstream proxy pool.

> ⚠️ **For Learning and Research Purposes Only**
>
> This project is intended solely as a learning exercise and technical
> demonstration. Free public proxies are inherently untrusted third-party
> servers — they may be unstable, inject malicious content, intercept
> traffic, or go offline without notice. **Never use this project to handle
> sensitive data, credentials, or any production workload.**
>
> If you need a reliable proxy for real-world use, please purchase a
> trustworthy commercial proxy service.
>
> **The author(s) of this project accept no responsibility or liability for
> any loss, damage, security incident, legal issue, or other consequence
> arising directly or indirectly from the use of this software.**

## Features

- Auto-fetch proxy list from `free-proxy-list.net/en/`
- Filter by:
  - `Google = yes`
  - `Https = yes`
- Auto-refresh proxy pool on a fixed interval
- Local proxy listener on port `2319` by default
- HTTPS tunneling via `CONNECT` with fallback to next upstream proxy

## How It Works

1. On startup, the service fetches and parses the proxy table HTML.
2. It extracts and deduplicates `IP:Port` entries that match the filter rules.
3. It listens for local proxy client traffic.
4. For each `CONNECT host:port` request, it tries upstream proxies in a
   round-robin candidate order.
5. On the first successful upstream tunnel (`HTTP 200`), it starts full duplex
   socket piping between client and upstream.
6. A background timer keeps refreshing the proxy pool so list updates are
   applied automatically.

## Project Structure

```text
.
|- index.js
|- package.json
|- README.md
|- README.zh-CN.md
`- LICENSE
```

## Requirements

- Node.js 18+ (LTS recommended)

## Install and Run

```bash
npm install
npm start
```

Or run directly:

```bash
node index.js
```

Default listener:

```text
0.0.0.0:2319
```

## Configuration

All options are configurable with environment variables:

- `PORT`: local listen port, default `2319`
- `REFRESH_INTERVAL_MS`: proxy refresh interval in milliseconds, default `60000`
- `MIN_REFRESH_GAP_MS`: minimum allowed refresh gap in milliseconds, default `15000`
- `CONNECT_TIMEOUT_MS`: upstream connect timeout in milliseconds, default `10000`

PowerShell example:

```powershell
$env:PORT=2319
$env:REFRESH_INTERVAL_MS=45000
$env:CONNECT_TIMEOUT_MS=8000
node index.js
```

## Usage

Point your program's HTTPS proxy to `127.0.0.1:2319`.

Example with `curl`:

```bash
curl -x http://127.0.0.1:2319 https://www.google.com -I
```

Notes:

- This service supports HTTPS tunneling via `CONNECT`.
- Regular HTTP proxying is not implemented and returns `405`.

## Logs

Typical logs:

- Refresh log:
  - `[refresh] ... loaded N proxies`
  - `[refresh] ... failed: <reason>`
- Connect log:
  - `[connect] targetHost:targetPort via proxyHost:proxyPort`

These logs help confirm whether pool refresh is healthy and whether traffic is
actually relayed through upstream proxies.

## Troubleshooting

1. Refresh failures such as `EACCES` or `ETIMEDOUT`
   - Usually means network access from current runtime is restricted.
2. `Proxy pool is empty`
   - No matching entries were parsed, or source HTML structure changed.
3. `502 Bad Gateway`
   - All candidate upstream proxies failed for this connection attempt.

## Security and Disclaimer

- **Free public proxies are inherently unstable and risky.** They are operated
  by unknown third parties and may snoop on, tamper with, or drop your traffic
  at any time.
- **This project is for learning purposes only.** Do not use it for sensitive,
  personal, or production-critical traffic.
- **For production use**, please purchase a reputable commercial proxy service
  instead of relying on free public proxies.
- **The author(s) disclaim all liability** for any damage, data loss, security
  breach, or legal consequence resulting from the use of this software. Use at
  your own risk.
- Make sure your use complies with applicable laws and target-site terms of
  service.

## License

This project is licensed under the MIT License. See `LICENSE`.
