import { describe, expect, it, vi } from "vitest";
import { KeysModel, keyStatus, rolePermissions } from "./operations-keys";

const key = {
	id: "key/1",
	name: "Reader",
	role: "readonly" as const,
	ops: "r",
	scope: "all" as const,
	space_ids: [],
	own_entries_only: false,
	auto_own_space: false,
	expires_at: null,
	revoked_at: null,
	last_used_at: null,
	created_at: 1,
	usage: [1, 2],
};

describe("key permissions and lifecycle", () => {
	it("only certifies a successfully read list and preserves cached rows on refresh failure", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValueOnce({ items: [key] })
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValueOnce({ items: [] });
		const model = new KeysModel({ request });
		expect(model.state).toMatchObject({ loaded: false });
		await model.load();
		expect(model.state).toMatchObject({ loaded: false, error: "Unable to load API keys." });
		await model.load();
		await model.load();
		expect(model.state).toMatchObject({
			loaded: true,
			items: [key],
			error: "Unable to load API keys.",
		});
		await model.load();
		expect(model.state).toMatchObject({ loaded: true, items: [], error: null });
	});
	it("updates template/custom permissions, rejects empty grants, and accepts 204 writes", async () => {
		const request = vi.fn().mockResolvedValue(undefined);
		const model = new KeysModel({ request });
		expect(await model.update("x", { role: "custom", expires_at: null })).toBe(false);
		expect(
			await model.update("x", {
				role: "custom",
				permissions: rolePermissions("custom"),
				expires_at: null,
			}),
		).toBe(false);
		request.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ items: [] });
		expect(await model.update("x", { role: "admin", expires_at: null })).toBe(true);
		expect(request).toHaveBeenCalledWith("/keys/x", {
			method: "PATCH",
			json: { role: "admin", expires_at: null, ...rolePermissions("admin") },
		});
		const permissions = { ...rolePermissions("custom"), ops: "r", scope: "all" as const };
		request.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ items: [] });
		expect(await model.update("x", { role: "custom", permissions, expires_at: null })).toBe(true);
		request.mockResolvedValueOnce({}).mockResolvedValueOnce({ items: [] });
		expect(await model.create({ name: "missing", role: "admin", expires_at: null })).toBeNull();
	});

	it("ignores late read/write errors and drops minted results during unmount refresh", async () => {
		let resolve: (value: unknown) => void = () => {};
		let reject: (reason: Error) => void = () => {};
		const request = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((_, fail) => {
						reject = fail;
					}),
			)
			.mockResolvedValueOnce({ items: [] });
		const model = new KeysModel({ request });
		const stale = model.load();
		await model.load();
		reject(new Error("private"));
		await stale;
		expect(model.state.error).toBeNull();
		request.mockResolvedValueOnce({ plaintext: "secret" }).mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const mint = model.rotate("x", 0);
		await Promise.resolve();
		model.dispose();
		resolve({ items: [] });
		expect(await mint).toBeNull();
		expect(await model.revoke("x")).toBe(false);
		const other = new KeysModel({ request });
		request.mockImplementationOnce(
			() =>
				new Promise((_, fail) => {
					reject = fail;
				}),
		);
		const late = other.revoke("x");
		other.dispose();
		reject(new Error("secret"));
		expect(await late).toBe(false);
		expect(other.state.error).toBeNull();
	});
	it("offers explicit role templates with default-deny custom permissions", () => {
		expect(rolePermissions("admin")).toMatchObject({ ops: "r,w,u,d", scope: "all" });
		expect(rolePermissions("project")).toMatchObject({ scope: "own", auto_own_space: true });
		expect(rolePermissions("drop")).toMatchObject({ ops: "w", scope: "own" });
		expect(rolePermissions("readonly")).toMatchObject({ ops: "r", scope: "all" });
		expect(rolePermissions("custom")).toMatchObject({ ops: "", scope: "spaces" });
		expect(keyStatus(key, 100)).toBe("active");
		expect(keyStatus({ ...key, expires_at: 100 }, 100)).toBe("expired");
		expect(keyStatus({ ...key, revoked_at: 0 }, 100)).toBe("revoked");
	});

	it("loads projected metadata, refreshes without clearing old rows, and retries", async () => {
		const request = vi.fn().mockResolvedValueOnce({ items: [{ ...key, plaintext: "forbidden" }] });
		const model = new KeysModel({ request });
		await model.load();
		expect(model.state.items).toEqual([key]);
		request.mockImplementationOnce(() => {
			expect(model.state.items).toEqual([key]);
			return Promise.reject(new Error("private detail"));
		});
		await model.load();
		expect(model.state.error).toBe("Unable to load API keys.");
		request.mockResolvedValueOnce({ items: [] });
		await model.load();
		expect(model.state).toMatchObject({ items: [], error: null, loading: false });
	});

	it("never stores minted plaintext and sends expiry and role permissions", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ key, plaintext: "octo_once" })
			.mockResolvedValueOnce({ items: [key] });
		const model = new KeysModel({ request });
		expect(await model.create({ name: " Reader ", role: "readonly", expires_at: 500 })).toBe(
			"octo_once",
		);
		expect(request).toHaveBeenNthCalledWith(1, "/keys", {
			method: "POST",
			json: { name: "Reader", role: "readonly", expires_at: 500, ...rolePermissions("readonly") },
		});
		expect(JSON.stringify(model.state)).not.toContain("octo_once");
	});

	it("rejects invalid creation without a request", async () => {
		const request = vi.fn();
		const model = new KeysModel({ request });
		expect(await model.create({ name: " ", role: "admin", expires_at: null })).toBeNull();
		expect(await model.create({ name: "x", role: "custom", expires_at: null })).toBeNull();
		expect(await model.create({ name: "x", role: "readonly", expires_at: Number.NaN })).toBeNull();
		expect(await model.create({ name: "x", role: "readonly", expires_at: -1 })).toBeNull();
		expect(
			await model.create({
				name: "x",
				role: "custom",
				expires_at: null,
				permissions: { ...rolePermissions("custom"), ops: "r", space_ids: [] },
			}),
		).toBeNull();
		expect(request).not.toHaveBeenCalled();
	});

	it("supports explicit custom scope, expiry updates, grace rotation and immediate revocation", async () => {
		const request = vi.fn().mockResolvedValue({ items: [key], key, plaintext: "rotated_once" });
		const model = new KeysModel({ request });
		await model.create({
			name: "Custom",
			role: "custom",
			expires_at: null,
			permissions: { ...rolePermissions("custom"), ops: "w", space_ids: ["inbox"] },
		});
		expect(request.mock.calls[0]?.[1].json.space_ids).toEqual(["inbox"]);
		expect(await model.rotate(key.id, 604800)).toBe("rotated_once");
		expect(request).toHaveBeenCalledWith("/keys/key%2F1/rotate", {
			method: "POST",
			json: { grace_seconds: 604800 },
		});
		expect(await model.update(key.id, { expires_at: null })).toBe(true);
		expect(request).toHaveBeenCalledWith("/keys/key%2F1", {
			method: "PATCH",
			json: { expires_at: null },
		});
		expect(await model.revoke(key.id)).toBe(true);
		expect(request).toHaveBeenCalledWith("/keys/key%2F1/revoke", { method: "POST" });
		const before = request.mock.calls.length;
		expect(await model.rotate(key.id, -1)).toBeNull();
		expect(await model.rotate(key.id, 604801)).toBeNull();
		expect(await model.rotate(key.id, 0.5)).toBeNull();
		expect(await model.update(key.id, { expires_at: -1 })).toBe(false);
		expect(request).toHaveBeenCalledTimes(before);
	});

	it("contains failures without exposing secrets and prevents overlapping writes", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue({ items: [] });
		const model = new KeysModel({ request });
		const pending = model.rotate("x", 0);
		expect(await model.revoke("x")).toBe(false);
		finish({ plaintext: "once" });
		expect(await pending).toBe("once");
		request.mockRejectedValueOnce(new Error("secret"));
		expect(await model.revoke("x")).toBe(false);
		expect(model.state.error).toBe("Unable to change API key.");
		request.mockRejectedValueOnce(new Error("secret"));
		expect(await model.rotate("x", 0)).toBeNull();
	});

	it("ignores stale reads and never reveals a result after disposal", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue({ items: [] });
		const model = new KeysModel({ request });
		const first = model.load();
		await model.load();
		finish({ items: [key] });
		await first;
		expect(model.state.items).toEqual([]);
		request.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const mint = model.rotate("x", 0);
		model.dispose();
		finish({ plaintext: "late-secret" });
		expect(await mint).toBeNull();
		expect(model.state.pending).toBe(false);
	});
});
