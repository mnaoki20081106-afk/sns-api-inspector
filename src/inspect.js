import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";

const target = process.env.TARGET_URL ?? process.argv[2];
if (!target) throw new Error("Set TARGET_URL to a public site you own or are authorized to inspect.");

const parsedTarget = new URL(target);
if (!["http:", "https:"].includes(parsedTarget.protocol)) {
  throw new Error("Only HTTP and HTTPS URLs are supported.");
}
if (parsedTarget.username || parsedTarget.password) {
  throw new Error("Do not put credentials in the URL.");
}

const hostname = parsedTarget.hostname.toLowerCase().replace(/^\[|\]$/g, "");
const blockedHostnames = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const isPrivateIPv4 = value => {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
};
const isPrivateIPv6 = value => {
  const ip = value.toLowerCase();
  return ip === "::" || ip === "::1" || ip.startsWith("fc") ||
    ip.startsWith("fd") || /^fe[89ab]/.test(ip) || ip.startsWith("::ffff:127.");
};
const ipVersion = isIP(hostname);
if (blockedHostnames.has(hostname) ||
    (ipVersion === 4 && isPrivateIPv4(hostname)) ||
    (ipVersion === 6 && isPrivateIPv6(hostname))) {
  throw new Error("Local and private-network targets are not allowed.");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const records = [];

page.on("request", request => {
  const url = new URL(request.url());
  records.push({
    type: "request",
    host: url.host,
    path: url.pathname,
    method: request.method(),
    parameter_names: [...new Set([...url.searchParams.keys()])],
    resource_type: request.resourceType()
  });
});

page.on("response", response => {
  const url = new URL(response.url());
  records.push({
    type: "response",
    host: url.host,
    path: url.pathname,
    status: response.status(),
    content_type: response.headers()["content-type"] ?? null
  });
});

try {
  await page.goto(parsedTarget.href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/network-report.json", JSON.stringify(records, null, 2));
} finally {
  await browser.close();
}
