import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	disposeE2eD1,
	e2eD1,
	effectCount,
	query,
	seedKey,
	seedSpace,
	stored,
} from "../../../../../tests/fixtures/l2-batch";

const state = vi.hoisted(() => ({
	exec: vi.fn<(args: string[]) => Promise<string>>(),
	create: vi.fn(),
	dispose: vi.fn(async () => {}),
}));
vi.mock("../../../../../scripts/fixture-d1", () => ({
	openFixtureD1: (...args: string[]) => state.create(...args),
}));
beforeEach(() => {
	state.exec.mockReset();
	state.create.mockReset().mockResolvedValue({ exec: state.exec, dispose: state.dispose });
	state.dispose.mockClear();
	vi.stubEnv("OCTO_PERSIST", "isolated-run");
	vi.stubEnv("OCTO_CONFIG", "isolated.toml");
});
afterEach(async () => {
	await disposeE2eD1();
	vi.unstubAllEnvs();
});

function deferred() {
	let resolve!: (stdout: string) => void;
	const promise = new Promise<string>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function remainsPending(promise: Promise<unknown>) {
	let settled = false;
	void promise.then(() => {
		settled = true;
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(settled).toBe(false);
}

describe("L2 async fixture call sites", () => {
	it("reuses one local runtime for repeated fixture access in an isolated process", async () => {
		state.exec.mockResolvedValue('[{"results":[{"value":"test"}]}]');
		await e2eD1();
		await e2eD1();
		expect(state.create).toHaveBeenCalledTimes(1);
	});
	it("disposes once after access, including a failed marker check", async () => {
		state.exec.mockResolvedValue('[{"results":[{"value":"production"}]}]');
		await expect(e2eD1()).rejects.toThrow("env=test");
		await disposeE2eD1();
		await disposeE2eD1();
		expect(state.dispose).toHaveBeenCalledTimes(1);
	});
	it("propagates startup failures without retrying or inventing a runtime to dispose", async () => {
		state.create.mockRejectedValueOnce(new Error("runtime failed"));
		await expect(e2eD1()).rejects.toThrow("runtime failed");
		await disposeE2eD1();
		expect(state.create).toHaveBeenCalledTimes(1);
		expect(state.dispose).not.toHaveBeenCalled();
	});
	it("refuses switching a live session to a different run", async () => {
		state.exec.mockResolvedValue('[{"results":[{"value":"test"}]}]');
		await e2eD1();
		vi.stubEnv("OCTO_PERSIST", "other-run");
		await expect(e2eD1()).rejects.toThrow("cannot change isolated runs");
		expect(state.create).toHaveBeenCalledTimes(1);
	});
	it("does not expose an executor until the isolated marker check completes", async () => {
		const marker = deferred();
		state.exec.mockReturnValueOnce(marker.promise).mockResolvedValue("[]");
		const pending = e2eD1();
		await remainsPending(pending);
		expect(state.exec).toHaveBeenCalledTimes(1);
		expect(state.exec).toHaveBeenCalledWith([
			"--command",
			"SELECT value FROM _test_marker WHERE key = 'env'",
			"--json",
		]);
		expect(state.create).toHaveBeenCalledExactlyOnceWith("isolated-run", "isolated.toml");
		marker.resolve('[{"results":[{"value":"test"}]}]');
		const d1 = await pending;
		await seedKey(d1);
		expect(state.exec).toHaveBeenCalledTimes(2);
		expect(state.exec.mock.calls[1]?.[0][1]).toContain("INSERT INTO api_keys");
	});
	it("refuses foreign ownership before any fixture mutation", async () => {
		state.exec.mockResolvedValue('[{"results":[{"value":"production"}]}]');
		await expect(
			(async () => {
				const d1 = await e2eD1();
				await seedKey(d1);
			})(),
		).rejects.toThrow("_test_marker");
		expect(state.exec).toHaveBeenCalledTimes(1);
	});
	it.each(["OCTO_PERSIST", "OCTO_CONFIG"])(
		"refuses missing %s instead of using daily state",
		async (name) => {
			vi.stubEnv(name, "");
			await expect(e2eD1()).rejects.toThrow("are required");
			expect(state.create).not.toHaveBeenCalled();
		},
	);
	it.each([seedKey, seedSpace])(
		"waits for a fixture write before returning its identity",
		async (seed) => {
			const write = deferred();
			const started = deferred();
			state.exec.mockImplementation(() => {
				started.resolve("");
				return write.promise;
			});
			const pending = seed(state.exec);
			await started.promise;
			await remainsPending(pending);
			expect(state.exec).toHaveBeenCalledTimes(1);
			write.resolve("[]");
			await pending;
		},
	);
	it("awaits post-HTTP observation queries and parses exact rows", async () => {
		state.exec.mockResolvedValue(
			'banner\n[{"results":[{"n":1,"id":"memory-id","title":"stored","deleted_at":null}]}]',
		);
		expect(await effectCount(state.exec, "key")).toBe(1);
		expect(await stored(state.exec, "id")).toEqual({
			n: 1,
			id: "memory-id",
			title: "stored",
			deleted_at: null,
		});
		expect(state.exec.mock.calls[0]?.[0][1]).toContain("FROM memories WHERE source_key_id");
		expect(state.exec.mock.calls[1]?.[0][1]).toContain("FROM memories m INNER JOIN spaces");
		state.exec.mockResolvedValue("[]");
		expect(await effectCount(state.exec, "missing")).toBe(0);
		expect(await stored(state.exec, "missing")).toBeUndefined();
		expect(await query(state.exec, "SELECT 1")).toEqual([]);
	});
});
