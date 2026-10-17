import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pre-push checks", () => {
	it.each(["none", "gate:no-remote", "test:e2e:api", "gate:security"])(
		"runs direct L2 and security, preserving %s failure",
		async (failure) => {
			const dir = await mkdtemp(join(tmpdir(), "octo-pre-push-"));
			try {
				const log = join(dir, "calls");
				const bun = join(dir, "bun");
				await writeFile(
					bun,
					'#!/bin/sh\nprintf "%s %s\\n" "$2" "$GITLEAKS_LOG_OPTS" >> "$CALL_LOG"\n[ "$2" != "$FAIL_COMMAND" ]\n',
				);
				await chmod(bun, 0o755);
				let status = 0;
				try {
					execFileSync("sh", [".husky/pre-push"], {
						input: "refs/heads/l2-miniflare abc refs/heads/l2-miniflare def\n",
						env: {
							...process.env,
							PATH: `${dir}:${process.env.PATH}`,
							CALL_LOG: log,
							FAIL_COMMAND: failure,
						},
					});
				} catch {
					status = 1;
				}
				expect(status).toBe(failure === "none" ? 0 : 1);
				const calls = await readFile(log, "utf8");
				expect(calls).toContain("gate:no-remote");
				if (failure !== "gate:no-remote") {
					expect(calls).toMatch(/test:e2e:api\s+def\.\.abc/);
					expect(calls).toMatch(/gate:security\s+def\.\.abc/);
				} else expect(calls).not.toContain("test:e2e:api");
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);
});
