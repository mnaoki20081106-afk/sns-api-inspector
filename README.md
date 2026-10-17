SNS API Inspector
=================

A GitHub Actions tool that opens a public page in a clean headless browser and records limited network metadata.

Recorded:
- Request host and path (query values are omitted)
- Query parameter names, HTTP method, and resource type
- Response status and content type

Not recorded: cookies, authorization headers, API keys, tokens, credentials, query values, raw request bodies, response bodies, page text, account data, or screenshots. It does not log in, reuse sessions, submit forms, make purchases, or bypass paid access.

Run from iPhone:
1. Open Actions in this repository.
2. Select 'Inspect public page network metadata'.
3. Tap 'Run workflow'.
4. Enter a public page URL you are authorized to inspect and run it.
5. Open the completed run and download the 'network-report' artifact.

The workflow uses a fresh browser without your logged-in session, so authenticated endpoints will not appear. Do not put credentials in the URL. Localhost and common private IP address targets are rejected. Respect site terms and rate limits.

Local run: npm install; npx playwright install chromium; node src/inspect.js https://example.com/

Report path: artifacts/network-report.json

## Documented API inventory

This separate mode inventories endpoints from an OpenAPI 3.0/3.1 JSON specification that is already present in the repository. It does not probe a live service or call API endpoints.

From iPhone:
1. Add a public or authorized OpenAPI JSON specification to the repository (for example, `docs/openapi.json`).
2. Open **Actions** and select **Build documented API inventory**.
3. Tap **Run workflow** and enter the repository-relative path to that JSON file.
4. Download the `api-inventory` artifact from the completed run.

The report lists documented HTTP methods and paths, operation IDs, tags, declared authentication requirements, request/response content types, and response codes. It does not contain credentials or execute requests.

Local run: `npm run inventory -- docs/openapi.json`

This mode requires a specification; it cannot discover undocumented/private endpoints from a site. Only use specifications you are authorized to inspect.
