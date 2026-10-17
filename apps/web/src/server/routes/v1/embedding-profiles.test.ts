import { afterEach, describe, expect, it } from "vitest";
import { PEPPER } from "../../audit/__tests__/app";
import { queryFixture } from "../../audit/__tests__/queries";
import { mintApiKey } from "../../auth/api-key";
import { embeddingProfilesRoutes } from "./embedding-profiles";

const active: ReturnType<typeof queryFixture>[] = [];
afterEach(async () => {
	for (const fixtureData of active.splice(0)) {
		await fixtureData.flush();
		fixtureData.sqlite.close();
	}
});
async function fixture() {
	const fixtureData = queryFixture();
	fixtureData.app.route("/api/v1/embedding-profiles", embeddingProfilesRoutes());
	const reader = await mintApiKey(fixtureData.db, PEPPER, {
		name: "reader",
		role: "readonly",
		ops: "r",
		scope: "all",
	});
	const writer = await mintApiKey(fixtureData.db, PEPPER, {
		name: "writer",
		role: "drop",
		ops: "w",
		scope: "all",
	});
	active.push(fixtureData);
	return {
		...fixtureData,
		reader,
		writer,
		get: (token: string | null = reader.plaintext) =>
			fixtureData.app.request(
				"/api/v1/embedding-profiles",
				{ headers: token ? { Authorization: `Bearer ${token}` } : {} },
				fixtureData.env,
				fixtureData.ctx,
			),
	};
}

describe("embedding profiles", () => {
	it("lists profiles and active id without internal gateway/index settings", async () => {
		const fixtureData = await fixture();
		fixtureData.sqlite.exec(
			"INSERT INTO embedding_profiles VALUES('inactive','other',3,'cosine','private-index',0,2)",
		);
		const res = await fixtureData.get();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			items: [
				{
					id: "inactive",
					model: "other",
					dims: 3,
					metric: "cosine",
					active: false,
					created_at: "1970-01-01T00:00:00.002Z",
				},
				{
					id: "te3-small-1536",
					model: "text-embedding-3-small",
					dims: 1536,
					metric: "cosine",
					active: true,
					created_at: "1970-01-01T00:00:00.001Z",
				},
			],
			active_profile: "te3-small-1536",
			next_cursor: null,
		});
	});

	it("returns null with no active profile or no profiles", async () => {
		const fixtureData = await fixture();
		fixtureData.sqlite.exec("UPDATE embedding_profiles SET active = 0");
		expect(await (await fixtureData.get()).json()).toMatchObject({ active_profile: null });
		fixtureData.sqlite.exec("DELETE FROM embedding_profiles");
		expect(await (await fixtureData.get()).json()).toEqual({
			items: [],
			active_profile: null,
			next_cursor: null,
		});
	});

	it("requires authentication and read operation", async () => {
		const fixtureData = await fixture();
		for (const token of [null, "bad"]) expect((await fixtureData.get(token)).status).toBe(401);
		const denied = await fixtureData.get(fixtureData.writer.plaintext);
		expect(denied.status).toBe(403);
		expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
	});
});
