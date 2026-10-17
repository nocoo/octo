import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { cursorSecretFromEnv } from "./cursor";

describe("cursorSecretFromEnv", () => {
	it("requires API_KEY_PEPPER", () => {
		expect(() => cursorSecretFromEnv({})).toThrow(ApiError);
	});
});
