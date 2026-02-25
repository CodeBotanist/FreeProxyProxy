const http = require("http");
const https = require("https");
const net = require("net");

const PORT = Number(process.env.PORT || 2319);
const PROXY_SOURCE_URL = "https://free-proxy-list.net/en/";
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 60_000);
const MIN_REFRESH_GAP_MS = Number(process.env.MIN_REFRESH_GAP_MS || 15_000);
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 10_000);

let proxyPool = [];
let refreshInFlight = null;
let lastRefreshAt = 0;
let nextProxyIndex = 0;

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(text) {
  return decodeHtmlEntities(text.replace(/<[^>]*>/g, "")).trim();
}

function parseProxyListFromHtml(html) {
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) {
    throw new Error("Cannot find proxy table body in response HTML");
  }

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const proxies = [];
  const seen = new Set();

  let rowMatch;
  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];

    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }

    if (cells.length < 7) {
      continue;
    }

    const host = cells[0];
    const port = Number(cells[1]);
    const google = (cells[5] || "").toLowerCase();
    const httpsSupport = (cells[6] || "").toLowerCase();

    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      continue;
    }

    if (google !== "yes" || httpsSupport !== "yes") {
      continue;
    }

    const key = `${host}:${port}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    proxies.push({ host, port });
  }

  return proxies;
}

function requestText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects"));
      return;
    }

    const currentUrl = new URL(url, PROXY_SOURCE_URL);
    const req = https.get(
      currentUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9"
        }
      },
      (res) => {
        const statusCode = res.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          resolve(
            requestText(
              new URL(res.headers.location, currentUrl).toString(),
              redirectCount + 1
            )
          );
          return;
        }

        if (statusCode !== 200) {
          reject(new Error(`Unexpected status code: ${statusCode}`));
          return;
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve(body);
        });
      }
    );

    req.setTimeout(15_000, () => {
      req.destroy(new Error("Fetch timeout"));
    });
    req.on("error", reject);
  });
}

async function refreshProxyPool(force = false) {
  const now = Date.now();
  if (!force && now - lastRefreshAt < MIN_REFRESH_GAP_MS) {
    return;
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const html = await requestText(PROXY_SOURCE_URL);
      const nextPool = parseProxyListFromHtml(html);

      if (nextPool.length === 0) {
        throw new Error("No Google+HTTPS proxies found");
      }

      proxyPool = nextPool;
      lastRefreshAt = Date.now();
      if (nextProxyIndex >= proxyPool.length) {
        nextProxyIndex = 0;
      }
      console.log(
        `[refresh] ${new Date().toISOString()} loaded ${proxyPool.length} proxies`
      );
    } catch (error) {
      console.error(
        `[refresh] ${new Date().toISOString()} failed: ${error.message}`
      );
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function pickProxyCandidates(limit) {
  if (proxyPool.length === 0 || limit <= 0) {
    return [];
  }

  const count = Math.min(limit, proxyPool.length);
  const candidates = [];
  for (let i = 0; i < count; i += 1) {
    const index = (nextProxyIndex + i) % proxyPool.length;
    candidates.push(proxyPool[index]);
  }
  nextProxyIndex = (nextProxyIndex + count) % proxyPool.length;
  return candidates;
}

function connectToUpstreamProxy(proxy, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const upstream = net.connect(proxy.port, proxy.host);
    let done = false;
    let responseBuffer = Buffer.alloc(0);

    function cleanup() {
      upstream.removeListener("error", onError);
      upstream.removeListener("timeout", onTimeout);
      upstream.removeListener("data", onData);
    }

    function fail(error) {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      upstream.destroy();
      reject(error);
    }

    function onError(error) {
      fail(error);
    }

    function onTimeout() {
      fail(new Error("Upstream connect timeout"));
    }

    function onData(chunk) {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      const headersEnd = responseBuffer.indexOf("\r\n\r\n");
      if (headersEnd === -1) {
        if (responseBuffer.length > 8192) {
          fail(new Error("Invalid upstream response"));
        }
        return;
      }

      const headerText = responseBuffer
        .slice(0, headersEnd)
        .toString("latin1")
        .trim();
      const firstLine = headerText.split("\r\n")[0] || "";
      const statusMatch = firstLine.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
      const remainder = responseBuffer.slice(headersEnd + 4);

      if (statusCode !== 200) {
        fail(new Error(`Upstream returned ${statusCode || "unknown"}`));
        return;
      }

      done = true;
      cleanup();
      resolve({ upstream, remainder });
    }

    upstream.setTimeout(CONNECT_TIMEOUT_MS);
    upstream.once("error", onError);
    upstream.once("timeout", onTimeout);
    upstream.on("data", onData);
    upstream.once("connect", () => {
      const connectPayload =
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        "Proxy-Connection: Keep-Alive\r\n" +
        "Connection: Keep-Alive\r\n\r\n";
      upstream.write(connectPayload);
    });
  });
}

async function createTunnel(targetHost, targetPort) {
  if (proxyPool.length === 0) {
    await refreshProxyPool(true);
  } else if (Date.now() - lastRefreshAt > REFRESH_INTERVAL_MS) {
    await refreshProxyPool();
  }

  const candidates = pickProxyCandidates(Math.max(1, proxyPool.length));
  if (candidates.length === 0) {
    throw new Error("Proxy pool is empty");
  }

  let lastError = null;
  for (const proxy of candidates) {
    try {
      const result = await connectToUpstreamProxy(proxy, targetHost, targetPort);
      return { ...result, proxy };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to create tunnel");
}

const server = http.createServer((req, res) => {
  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("This proxy only supports HTTPS tunneling via CONNECT.\n");
});

server.on("connect", async (req, clientSocket, head) => {
  const target = req.url || "";
  const splitIndex = target.lastIndexOf(":");
  if (splitIndex <= 0) {
    clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  const targetHost = target.slice(0, splitIndex);
  const targetPort = Number(target.slice(splitIndex + 1)) || 443;
  const normalizedTargetHost =
    targetHost.startsWith("[") && targetHost.endsWith("]")
      ? targetHost.slice(1, -1)
      : targetHost;

  try {
    const { upstream, remainder, proxy } = await createTunnel(
      normalizedTargetHost,
      targetPort
    );

    clientSocket.write(
      "HTTP/1.1 200 Connection Established\r\n" +
        "Proxy-Agent: autoproxy\r\n\r\n"
    );

    if (head && head.length > 0) {
      upstream.write(head);
    }
    if (remainder.length > 0) {
      clientSocket.write(remainder);
    }

    upstream.on("error", () => {
      clientSocket.destroy();
    });
    clientSocket.on("error", () => {
      upstream.destroy();
    });

    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);

    console.log(
      `[connect] ${normalizedTargetHost}:${targetPort} via ${proxy.host}:${proxy.port}`
    );
  } catch (error) {
    clientSocket.end(
      "HTTP/1.1 502 Bad Gateway\r\n" +
        "Content-Type: text/plain; charset=utf-8\r\n" +
        "Connection: close\r\n\r\n" +
        `${error.message}\n`
    );
  }
});

server.listen(PORT, () => {
  console.log(`[server] listening on 0.0.0.0:${PORT}`);
});

refreshProxyPool(true).catch(() => {});
setInterval(() => {
  refreshProxyPool().catch(() => {});
}, REFRESH_INTERVAL_MS).unref();
