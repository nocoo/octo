import { describe, expect, it } from "vitest";
import {
	type AuthzKey,
	type AuthzOp,
	authorize,
	type OpFlag,
	parseOps,
	ROLE_TEMPLATES,
	spaceVisible,
	visibleSpaceIds,
} from "./authorize";

const FLAGS: OpFlag[] = ["r", "w", "u", "d"];
const OPS: Exclude<AuthzOp, "move" | "tag_global">[] = ["read", "write", "update", "delete"];
const SCOPES: AuthzKey["scope"][] = ["all", "spaces", "own"];

function subsets(): OpFlag[][] {
	const out: OpFlag[][] = [[]];
	for (const flag of FLAGS) {
		const n = out.length;
		for (let i = 0; i < n; i += 1) {
			const current = out[i];
			if (current) {
				out.push([...current, flag]);
			}
		}
	}
	return out;
}

function key(partial: Partial<AuthzKey> & Pick<AuthzKey, "ops" | "scope">): AuthzKey {
	return {
		id: "K1",
		spaceIds: ["s1"],
		ownedSpaceIds: ["s2"],
		ownEntriesOnly: false,
		...partial,
	};
}

describe("parseOps", () => {
	it("keeps r/w/u/d and drops unknown tokens", () => {
		expect([...parseOps("r,w,u,d")].sort()).toEqual(["d", "r", "u", "w"]);
		expect([...parseOps(" r, x, d ")]).toEqual(["r", "d"]);
		expect(parseOps("").size).toBe(0);
	});
});

describe("visibleSpaceIds", () => {
	it("returns all, listed spaces, or owned spaces", () => {
		expect(visibleSpaceIds(key({ ops: new Set(), scope: "all" }))).toEqual({ kind: "all" });
		expect(visibleSpaceIds(key({ ops: new Set(), scope: "spaces" }))).toEqual({
			kind: "ids",
			ids: ["s1"],
		});
		expect(visibleSpaceIds(key({ ops: new Set(), scope: "own" }))).toEqual({
			kind: "ids",
			ids: ["s2"],
		});
		expect(spaceVisible(key({ ops: new Set(), scope: "all" }), "sx")).toBe(true);
		expect(spaceVisible(key({ ops: new Set(), scope: "spaces" }), "s1")).toBe(true);
		expect(spaceVisible(key({ ops: new Set(), scope: "spaces" }), "s2")).toBe(false);
		expect(spaceVisible(key({ ops: new Set(), scope: "own" }), "s2")).toBe(true);
		expect(spaceVisible(key({ ops: new Set(), scope: "own" }), "s1")).toBe(false);
	});
});

describe("authorize matrix", () => {
	it("covers ops, scopes, visibility, own_entries_only, move, and tag ops", () => {
		const needed: Record<Exclude<AuthzOp, "move" | "tag_global">, OpFlag> = {
			read: "r",
			write: "w",
			update: "u",
			delete: "d",
		};
		const inScope: Record<AuthzKey["scope"], string> = { all: "s9", spaces: "s1", own: "s2" };
		const outScope: Record<AuthzKey["scope"], string> = { all: "s9", spaces: "s2", own: "s1" };
		for (const ops of subsets()) {
			const opSet = new Set(ops);
			for (const scope of SCOPES) {
				for (const ownEntriesOnly of [false, true]) {
					const actor = key({ ops: opSet, scope, ownEntriesOnly });
					for (const op of OPS) {
						if (scope !== "all") {
							expect(authorize(actor, op, { spaceId: outScope[scope] })).toEqual({
								allow: false,
								reason: "not_found",
							});
						}
						const visible = authorize(actor, op, {
							spaceId: inScope[scope],
							sourceKeyId: "other",
						});
						if (!opSet.has(needed[op])) {
							expect(visible).toEqual({ allow: false, reason: "forbidden" });
							continue;
						}
						if (ownEntriesOnly && (op === "update" || op === "delete")) {
							expect(visible).toEqual({ allow: false, reason: "forbidden" });
							expect(authorize(actor, op, { spaceId: inScope[scope], sourceKeyId: "K1" })).toEqual({
								allow: true,
							});
							continue;
						}
						expect(visible).toEqual({ allow: true });
					}
				}
			}
		}
		const mover = key({ ops: new Set(["u"]), scope: "spaces", spaceIds: ["s1", "s3"] });
		expect(authorize(mover, "move", { spaceId: "s1", destSpaceId: "s3" })).toEqual({
			allow: true,
		});
		expect(authorize(mover, "move", { spaceId: "s1", destSpaceId: "s2" })).toEqual({
			allow: false,
			reason: "not_found",
		});
		expect(authorize(mover, "move", { spaceId: "s1" })).toEqual({
			allow: false,
			reason: "not_found",
		});
		expect(
			authorize(key({ ops: new Set(["r"]), scope: "all" }), "move", {
				spaceId: "s1",
				destSpaceId: "s2",
			}),
		).toEqual({ allow: false, reason: "forbidden" });
		expect(
			authorize(key({ ops: new Set(["u"]), scope: "all", ownEntriesOnly: true }), "move", {
				spaceId: "s1",
				destSpaceId: "s2",
				sourceKeyId: "other",
			}),
		).toEqual({ allow: false, reason: "forbidden" });
		expect(
			authorize(key({ ops: new Set(["u"]), scope: "all", ownEntriesOnly: true }), "move", {
				spaceId: "s1",
				destSpaceId: "s2",
				sourceKeyId: "K1",
			}),
		).toEqual({ allow: true });
		expect(authorize(key({ ops: new Set(["u"]), scope: "all" }), "tag_global", {})).toEqual({
			allow: true,
		});
		expect(authorize(key({ ops: new Set(["r"]), scope: "all" }), "tag_global", {})).toEqual({
			allow: false,
			reason: "forbidden",
		});
		expect(authorize(key({ ops: new Set(["u"]), scope: "spaces" }), "tag_global", {})).toEqual({
			allow: false,
			reason: "forbidden",
		});
		expect(ROLE_TEMPLATES.admin).toEqual({ ops: "r,w,u,d", scope: "all", autoOwnSpace: false });
		expect(ROLE_TEMPLATES.project.scope).toBe("own");
		expect(ROLE_TEMPLATES.drop.ops).toBe("w");
		expect(ROLE_TEMPLATES.readonly.ops).toBe("r");
	});
});
