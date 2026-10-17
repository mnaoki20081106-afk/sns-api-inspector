
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

const target = process.env.TARGET_URL ?? process.argv[2];
if (!target) {
  throw new Error("Usage: node api-analyzer.js https://your-site.example");
}

const startUrl = new URL(target);
if (!["http:", "https:"].includes(startUrl.protocol)) {
  throw new Error("Only HTTP and HTTPS are supported.");
}
if (startUrl.username || startUrl.password) {
  throw new Error("Credentials in URLs are not supported.");
}

const blockedHosts = new Set([
  "localhost", "localhost.localdomain", "metadata.google.internal",
]);

function privateIp(host) {
  const ip = host.replace(/^\[|\]$/g, "").toLowerCase();
  const v = isIP(ip);

  if (blockedHosts.has(ip)) return true;
  if (v === 4) {
    const p = ip.split(".").map(Number);
    const [a, b, c] = p;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    return ip === "::" || ip === "::1" ||
      ip.startsWith("fc") || ip.startsWith("fd") ||
      /^fe[89ab]/.test(ip) ||
      /^::ffff:(127\.|10\.|192\.168\.|169\.254\.)/.test(ip);
  }
  return false;
}

if (privateIp(startUrl.hostname)) {
  throw new Error("Local/private IP targets are not allowed.");
}

const MAX_PAGES = Number(process.env.MAX_PAGES ?? 30);
const WAIT_MS = Number(process.env.WAIT_MS ?? 1000);
const MAX_BODY_BYTES = 1_000_000;

const SECRET =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|credential|session|jwt|access[-_]?key/i;

const API_PATH =
  /\/(api|apis|v\d+|graphql|rest|rpc|trpc|query|mutation)(\/|$)/i;

function redact(value, key = "", depth = 0) {
  if (SECRET.test(key)) return "[REDACTED]";
  if (depth > 6) return "[MAX_DEPTH]";

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(v => redact(v, "", depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 80)
        .map(([k, v]) => [k, redact(v, k, depth + 1)])
    );
  }
  if (typeof value === "string") {
    return value.length > 500 ? value.slice(0, 500) + "[TRUNCATED]" : value;
  }
  return value;
}

function jsonParse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

function shape(value, depth = 0) {
  if (depth > 5) return "depth_limit";
  if (value === null) return "null";

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      item: value.length ? shape(value[0], depth + 1) : "unknown",
    };
  }

  if (typeof value === "object") {
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(value).slice(0, 80)
          .map(([k, v]) => [k, shape(v, depth + 1)])
      ),
    };
  }

  return typeof value;
}

function urlInfo(raw) {
  const u = new URL(raw);
  return {
    origin: u.origin,
    path: u.pathname,
    query_parameter_names: [...new Set(u.searchParams.keys())],
  };
}

function requestBody(request) {
  const raw = request.postData();
  if (!raw) return null;

  const headers = request.headers();
  const contentType = headers["content-type"] ?? "";

  if (/json/i.test(contentType)) {
    const parsed = jsonParse(raw);
    if (parsed !== undefined) {
      return {
        format: "json",
        shape: shape(parsed),
        preview: redact(parsed),
      };
    }
  }

  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    return {
      format: "form",
      parameter_names: [...new Set(new URLSearchParams(raw).keys())],
    };
  }

  return {
    format: contentType || "unknown",
    length: raw.length,
    omitted: true,
  };
}

function classify(request, response) {
  const u = new URL(request.url());
  const contentType = response?.headers()["content-type"] ?? "";
  const resource = request.resourceType();
  const signals = [];

  if (API_PATH.test(u.pathname)) signals.push("api_path");
  if (/graphql/i.test(u.pathname)) signals.push("graphql_path");
  if (resource === "xhr") signals.push("xhr");
  if (resource === "fetch") signals.push("fetch");
  if (/json/i.test(contentType)) signals.push("json_response");

  return {
    signals,
    confidence: signals.length >= 2 ? "high" :
      signals.length === 1 ? "medium" : "low",
    candidate: signals.length > 0,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const byRequest = new Map();
const responseTasks = [];
const visitedPages = new Set();
const pageErrors = [];

const report = {
  target: startUrl.origin,
  started_at: new Date().toISOString(),
  pages: [],
  requests: [],
  errors: [],
};

function recordRequest(request, pageUrl) {
  const id = randomUUID();
  const headers = request.headers();

  const entry = {
    id,
    page: pageUrl,
    request: {
      ...urlInfo(request.url()),
      method: request.method(),
      resource_type: request.resourceType(),
      header_names: Object.keys(headers),
      content_type: headers["content-type"] ?? null,
      body: requestBody(request),
    },
    classification: classify(request, null),
    response: null,
  };

  byRequest.set(request, entry);
  report.requests.push(entry);
}

page.on("request", request => {
  recordRequest(request, page.url());
});

page.on("response", response => {
  responseTasks.push((async () => {
    const request = response.request();
    const entry = byRequest.get(request);
    if (!entry) return;

    const headers = response.headers();
    const contentType = headers["content-type"] ?? "";

    entry.response = {
      status: response.status(),
      ok: response.ok(),
      content_type: contentType,
      header_names: Object.keys(headers),
      body: null,
    };
    entry.classification = classify(request, response);

    if (!/json/i.test(contentType) ||
        [204, 304].includes(response.status())) return;

    try {
      const body = await response.body();

      if (body.length > MAX_BODY_BYTES) {
        entry.response.body = {
          omitted: true,
          reason: "response_over_1mb",
          bytes: body.length,
        };
        return;
      }

      const parsed = jsonParse(body.toString("utf8"));
      if (parsed !== undefined) {
        entry.response.body = {
          format: "json",
          bytes: body.length,
          shape: shape(parsed),
          preview: redact(parsed),
        };
      } else {
        entry.response.body = {
          format: "invalid_json",
          bytes: body.length,
        };
      }
    } catch {
      entry.response.body = { omitted: true, reason: "unavailable" };
    }
  })());
});

page.on("requestfailed", request => {
  report.errors.push({
    url: urlInfo(request.url()),
    method: request.method(),
    error: request.failure()?.errorText ?? "unknown",
  });
});

async function waitForResponses() {
  await Promise.allSettled(responseTasks.splice(0));
}

async function inspectPage(url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  await page.waitForTimeout(WAIT_MS);
  await waitForResponses();

  const links = await page.locator("a[href]").evaluateAll(
    elements => elements.map(el => el.href)
  );

  const buttons = page.locator(
    'button:visible, input[type="button"]:visible, input[type="submit"]:visible'
  );

  const buttonCount = Math.min(await buttons.count(), 10);
  const interactions = [];

  for (let i = 0; i < buttonCount; i++) {
    const button = buttons.nth(i);

    try {
      const label = (await button.innerText({ timeout: 1000 })
        .catch(() => "")) ||
        await button.getAttribute("aria-label") || "";

      if (!(await button.isVisible())) continue;
      if (!(await button.isEnabled())) continue;

      const before = report.requests.length;

      await button.click({ timeout: 2000 });
      await page.waitForTimeout(WAIT_MS);
      await waitForResponses();

      interactions.push({
        type: "button",
        label: label.slice(0, 100),
        new_requests: report.requests.length - before,
      });
    } catch {
      interactions.push({
        type: "button",
        index: i,
        result: "skipped",
      });
    }
  }

  return { links, interactions };
}

try {
  const queue = [startUrl.href];

  while (queue.length && visitedPages.size < MAX_PAGES) {
    const current = queue.shift();
    if (visitedPages.has(current)) continue;

    const parsed = new URL(current);
    if (parsed.origin !== startUrl.origin) continue;
    if (!["http:", "https:"].includes(parsed.protocol)) continue;

    visitedPages.add(current);

    try {
      const { links, interactions } = await inspectPage(current);

      report.pages.push({
        url: current,
        interactions,
      });

      for (const href of links) {
        try {
          const next = new URL(href);
          if (
            next.origin === startUrl.origin &&
            ["http:", "https:"].includes(next.protocol) &&
            !visitedPages.has(next.href) &&
            !queue.includes(next.href)
          ) {
            queue.push(next.href);
          }
        } catch {
          // Ignore malformed links.
        }
      }
    } catch (error) {
      pageErrors.push({
        page: current,
        error: error.message,
      });
    }
  }

  await waitForResponses();

  const apiCandidates = report.requests.filter(
    entry => entry.classification.candidate
  );

  const unique = new Map();

  for (const entry of apiCandidates) {
    const key = [
      entry.request.method,
      entry.request.origin,
      entry.request.path,
    ].join(" ");

    if (!unique.has(key)) {
      unique.set(key, {
        method: entry.request.method,
        origin: entry.request.origin,
        path: entry.request.path,
        seen: 0,
        statuses: [],
        signals: new Set(),
      });
    }

    const item = unique.get(key);
    item.seen++;

    if (entry.response) item.statuses.push(entry.response.status);
    for (const signal of entry.classification.signals) {
      item.signals.add(signal);
    }
  }

  report.finished_at = new Date().toISOString();
  report.page_errors = pageErrors;
  report.api_candidates = [...unique.values()].map(item => ({
    ...item,
    signals: [...item.signals],
    statuses: [...new Set(item.statuses)],
  }));

  report.summary = {
    pages_visited: visitedPages.size,
    total_requests: report.requests.length,
    api_candidate_requests: apiCandidates.length,
    unique_api_candidates: report.api_candidates.length,
    failed_requests: report.errors.length,
    page_errors: pageErrors.length,
  };

  await mkdir("artifacts", { recursive: true });

  await writeFile(
    "artifacts/api-report.json",
    JSON.stringify(report, null, 2),
    "utf8"
  );

  await writeFile(
    "artifacts/api-endpoints.json",
    JSON.stringify(report.api_candidates, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(report.summary, null, 2));
  console.log("Saved reports in artifacts/");
} finally {
  await browser.close();
}
