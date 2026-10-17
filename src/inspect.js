import { chromium } from "playwright";

const target = process.env.TARGET_URL;
if (!target) throw new Error("Set TARGET_URL to a site you own or are authorized to inspect.");

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
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await import("node:fs/promises").then(fs =>
    fs.writeFile("network-report.json", JSON.stringify(records, null, 2))
  );
} finally {
  await browser.close();
}
