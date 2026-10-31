import { describe, expect, it, vi } from "vitest";
import { KeyUsageModel } from "./operations-key-usage";

const now = () => Date.parse("2026-10-18T00:30:00+08:00");
const path = "/usage?from=2026-09-18&to=2026-10-17&limit=200";
const row = (day: string, key_id: string, calls: number) => ({
	day,
	key_id,
	key_name: `Agent ${key_id}`,
	calls,
	errors: 0,
	writes: 0,
	bytes_in: 0,
	bytes_out: 0,
});

describe("independent key usage", () => {
	it("loads all pages once for all keys and maps 30 UTC days in chronological order", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({
				items: [
					row("2026-10-17", "key-a", 8),
					row("2026-10-17", "key-b", 2),
					...Array.from({ length: 198 }, (_, index) => row("2026-10-17", `other-${index}`, 1)),
				],
				next_cursor: "page+/=2",
			})
			.mockImplementationOnce(() => {
				expect(model.usage("key-a")).toBeNull();
				return Promise.resolve({
					items: [row("2026-10-16", "key-a", 3), row("2026-09-18", "key-a", 1)],
					next_cursor: null,
				});
			});
		const model = new KeyUsageModel({ request }, now);
		expect(model.state).toMatchObject({ snapshot: null, loading: false, error: null });
		await model.load();
		expect(request.mock.calls.map(([url]) => url)).toEqual([path, `${path}&cursor=page%2B%2F%3D2`]);
		const usage = model.usage("key-a");
		expect(usage?.total).toBe(12);
		expect(usage?.data).toHaveLength(30);
		expect(usage?.data[0]).toEqual({ x: "2026-09-18", calls: 1 });
		expect(usage?.data[1]).toEqual({ x: "2026-09-19", calls: 0 });
		expect(usage?.data.at(-2)).toEqual({ x: "2026-10-16", calls: 3 });
		expect(usage?.data.at(-1)).toEqual({ x: "2026-10-17", calls: 8 });
		expect(model.usage("key-b")?.total).toBe(2);
		expect(model.usage("unused")?.data).toHaveLength(30);
		expect(model.usage("unused")?.total).toBe(0);
		expect(request).toHaveBeenCalledTimes(2);
		expect(model.state).toMatchObject({ loading: false, error: null });
	});

	it("certifies zeros only after a successful empty response and preserves stale data on failure", async () => {
		const request = vi.fn().mockRejectedValueOnce(new Error("private detail"));
		const model = new KeyUsageModel({ request }, now);
		await model.load();
		expect(model.usage("a")).toBeNull();
		expect(model.state.error).toBe("无法加载密钥用量。");
		request.mockResolvedValueOnce({ items: [row("2026-10-17", "a", 7)], next_cursor: null });
		await model.load();
		const snapshot = model.state.snapshot;
		request
			.mockResolvedValueOnce({ items: [row("2026-10-17", "a", 99)], next_cursor: "next" })
			.mockRejectedValueOnce(new Error("secret"));
		await model.load();
		expect(model.state.snapshot).toBe(snapshot);
		expect(model.usage("a")?.total).toBe(7);
		expect(model.state.error).toBe("无法加载密钥用量。");
		request.mockResolvedValueOnce({ items: [], next_cursor: null });
		await model.load();
		expect(model.usage("a")?.data.every((point) => point.calls === 0)).toBe(true);
		expect(model.state.error).toBeNull();
	});

	it("does not certify partial pages as zero usage on first-load failure", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: [row("2026-10-17", "a", 7)], next_cursor: "next" })
			.mockRejectedValueOnce(new Error("private"));
		const model = new KeyUsageModel({ request }, now);
		await model.load();
		expect(model.state.snapshot).toBeNull();
		expect(model.usage("a")).toBeNull();
		expect(model.usage("unknown")).toBeNull();
	});

	it.each(["resolve", "reject"])(
		"ignores superseded page %s and stops stale pagination",
		async (outcome) => {
			let resolve: (value: unknown) => void = () => {};
			let reject: (error: Error) => void = () => {};
			const request = vi.fn().mockImplementationOnce(
				() =>
					new Promise((done, fail) => {
						resolve = done;
						reject = fail;
					}),
			);
			const model = new KeyUsageModel({ request }, now);
			const old = model.load();
			request.mockResolvedValueOnce({ items: [row("2026-10-17", "a", 4)], next_cursor: null });
			await model.load();
			if (outcome === "resolve")
				resolve({ items: [row("2026-10-17", "a", 100)], next_cursor: "stale" });
			else reject(new Error("private"));
			await old;
			expect(model.usage("a")?.total).toBe(4);
			expect(model.state.error).toBeNull();
			expect(request).toHaveBeenCalledTimes(2);
		},
	);

	it("retains the old date window while refreshing across UTC midnight", async () => {
		let clock = Date.parse("2026-10-17T23:59:59Z");
		const request = vi.fn().mockResolvedValue({ items: [], next_cursor: null });
		const model = new KeyUsageModel({ request }, () => clock);
		await model.load();
		clock += 2000;
		request.mockImplementationOnce(() => {
			expect(model.state).toMatchObject({ loading: true, snapshot: { to: "2026-10-17" } });
			return Promise.resolve({ items: [], next_cursor: null });
		});
		await model.load();
		expect(request).toHaveBeenLastCalledWith("/usage?from=2026-09-19&to=2026-10-18&limit=200");
		expect(model.state.snapshot).toMatchObject({ from: "2026-09-19", to: "2026-10-18" });
	});

	it("stops disposed pagination and never starts another request", async () => {
		let resolve: (value: unknown) => void = () => {};
		const request = vi.fn().mockImplementation(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const model = new KeyUsageModel({ request }, now);
		const pending = model.load();
		model.dispose();
		resolve({ items: [], next_cursor: "next" });
		await pending;
		await model.load();
		expect(request).toHaveBeenCalledTimes(1);
		expect(model.state).toMatchObject({ snapshot: null, loading: false, error: null });
	});

	it.each([
		{ items: [], next_cursor: "repeat" },
		{ items: [], next_cursor: undefined },
		{ items: [row("2026-10-17", "a", -1)], next_cursor: null },
		{ items: [row("2026-10-18", "a", 1)], next_cursor: null },
	])("fails closed on invalid or cyclic pages: %j", async (page) => {
		const request = vi.fn().mockResolvedValue(page);
		const model = new KeyUsageModel({ request }, now);
		await model.load();
		expect(model.state).toMatchObject({
			snapshot: null,
			loading: false,
			error: "无法加载密钥用量。",
		});
		expect(request.mock.calls.length).toBeLessThanOrEqual(2);
	});
});
