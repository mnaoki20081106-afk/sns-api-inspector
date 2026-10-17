import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const target = process.env.TARGET_URL ?? process.argv[2];
if (!target) throw new Error("Set TARGET_URL to a site you own or are authorized to inspect.");

const parsedTarget = new URL(target);
if (!["http:", "https:"].includes(parsedTarget.protocol)) {
  throw new Error("Only HTTP and HTTPS URLs are supported.");
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
    status: response.status()
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
