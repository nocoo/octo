# Dashboard L3

Run `bun run test:e2e:bdd` from the repository root. Do not run it alongside L2 or the full unit suite.

The runner builds the real SPA, migrates a new local D1 store only after writing and checking `_test_marker(env=test)`, and starts the real Worker on `http://127.0.0.1:27059`. Access uses the shared RSA/JWKS stub on an OS-assigned loopback port. No admin endpoint is mocked or replaced. Only the external embedding provider is represented by a local HTTP gateway that verifies authentication and User-Agent.

Persistence is retained at `.wrangler/e2e-pw/<run-id>`. Wrangler configuration, built assets and signing state live at `.wrangler/e2e-pw-run/<run-id>`. Reusing a run directory fails rather than resetting it. The runner never kills a process merely because it occupies a port.

Artifacts are retained under `test-results/l3/<run-id>/`:

- `run.json`: local endpoint and isolated run paths.
- `browser/**`: named, credential-masked screenshots attached to each test.
- `report/index.html`: Playwright report with screenshot attachments.

The runner and screenshot helper print these paths. Tracing, video, automatic screenshots and automatic accessibility snapshots are disabled because key minting and embedding requests contain write-only credentials. Explicit screenshots mask only the localized secret inputs, not identically named page regions or tables. Secret entry uses an input evaluation rather than `fill`, whose Playwright step title would persist the plaintext. Locator assertion failures can still include an accessibility snapshot, so the mint/rotate reveal intervals use boolean visibility polling and never put raw credentials into matcher arguments.

The suite covers search/read/edit, a real two-tab version conflict, diff and rollback; dirty-editor cancellation and discard through reader links, sidebar, command palette and browser Back; first-navigation search focus and mobile navigation focus restoration; one-time key mint/copy/close/revoke; delete/restore/title-gated purge; mobile reader/TOC; embedding defaults/masking/local connection/clear; every dashboard page; and light/dark with normal/reduced motion. Retries, disabled tests and fixed sleeps are not used.

The populated visual journey captures all 16 page variants in desktop light, mobile dark and desktop dark/reduced-motion, plus the settled mobile drawer and a successful empty search. Its usage fixture calls the real local scheduled handler at `/cdn-cgi/local/scheduled?format=json`, checks the JSON response and then verifies the resulting usage row; a SPA fallback response is not evidence of a cron execution. A separate journey uploads a Unicode-named attachment through the editor and checks the real signed R2 download. These captures do not claim exhaustive WCAG certification or a live Giraffe comparison.

Global setup rejects mismatched run paths, non-local destinations, remote bindings or a missing test marker. It then probes the real admin memory API. Missing M7 admin routes fail explicitly with `L3 blocked`; test discovery or runner unit tests are not evidence that browser integration passed.
