SNS API Inspector
=================

A GitHub Actions tool that opens a public page in a clean headless browser and records network metadata only.

Recorded: request URL origin/path (query values removed), query parameter names, HTTP method, resource type, response status, and JSON/form body parameter names.

Not recorded: cookies, authorization headers, API keys, tokens, credentials, query values, raw request bodies, page text, account data, or screenshots. It does not log in, reuse sessions, submit forms, make purchases, or bypass paid access.

Run from iPhone:
1. Open Actions in this repository.
2. Select 'Inspect public page network metadata'.
3. Tap 'Run workflow'.
4. Enter a public page URL you are authorized to inspect and run it.
5. Open the completed run and download the 'network-report' artifact.

The workflow uses a fresh browser without your logged-in session, so authenticated endpoints will not appear. Do not put credentials in the URL. Respect site terms and rate limits.

Local run: npm install; npx playwright install chromium; node src/inspect.js https://example.com/

Report path: artifacts/network-report.json
