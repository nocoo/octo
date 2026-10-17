import type { DataTableProps, DataTableSort } from "@nocoo/basalt/components/data-table";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	EmbeddingModel,
	EmbeddingProfile,
	SettingsModel,
} from "../viewmodels/operations-embedding";
import { EmbeddingPage, SettingsPage } from "./operations-embedding";

const fixture = vi.hoisted(() => ({
	state: {} as Partial<EmbeddingModel["state"]>,
	settings: {} as Partial<SettingsModel["state"]> & { loaded?: boolean },
	sort: null as DataTableSort | null,
}));
vi.mock("@nocoo/basalt/components/data-table", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/data-table")>();
	return {
		...module,
		DataTable: (props: DataTableProps<EmbeddingProfile>) => (
			<module.DataTable {...props} defaultSort={fixture.sort} />
		),
	};
});
vi.mock("../viewmodels/operations-embedding", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-embedding")>();
	return {
		...module,
		EmbeddingModel: class extends module.EmbeddingModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.state };
			}
		},
		SettingsModel: class extends module.SettingsModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.settings };
			}
		},
	};
});

beforeEach(() => {
	fixture.state = {};
	fixture.settings = {};
	fixture.sort = null;
});

describe("profile read states", () => {
	function render() {
		return renderToStaticMarkup(
			<MemoryRouter>
				<SettingsPage />
			</MemoryRouter>,
		);
	}
	it.each(["asc", "desc"] as const)("sorts active profile status %s through Basalt", (dir) => {
		fixture.settings = {
			loaded: true,
			profiles: [
				{ id: "profile-inactive", model: "model", dims: 512, metric: "cosine", active: false },
				{ id: "profile-active", model: "model", dims: 512, metric: "cosine", active: true },
			],
		};
		fixture.sort = { id: "active", dir };
		const html = render();
		const ids = [...html.matchAll(/<td[^>]*>(profile-(?:active|inactive))<\/td>/g)].map(
			(match) => match[1],
		);
		expect(ids).toEqual(
			dir === "asc"
				? ["profile-active", "profile-inactive"]
				: ["profile-inactive", "profile-active"],
		);
	});
	it.each([null, "Unable to load embedding profiles."])(
		"does not assert an empty unknown profiles list: %s",
		(error) => {
			fixture.settings = { loaded: false, error };
			const html = render();
			expect(html).not.toContain("No embedding profiles configured.");
			if (error) expect(html).toContain(error);
		},
	);
	it("distinguishes successful emptiness and preserves profiles after a refresh failure", () => {
		fixture.settings = { loaded: true };
		expect(render()).toContain("No embedding profiles configured.");
		fixture.settings = {
			loaded: true,
			error: "Unable to load embedding profiles.",
			profiles: [
				{ id: "cached-profile", model: "active-model", dims: 512, metric: "cosine", active: true },
			],
		};
		const html = render();
		expect(html).toContain("cached-profile");
		expect(html).toContain("Unable to load embedding profiles.");
	});
});

describe("embedding configuration visibility", () => {
	it.each([null, "Unable to load embedding settings."])(
		"keeps unknown settings out of the editor with error %s",
		(error) => {
			fixture.state = { loaded: false, error };
			const html = renderToStaticMarkup(<EmbeddingPage />);
			expect(html).not.toContain("No API key configured");
			expect(html).not.toContain("text-embedding-3-small");
			expect(html).not.toContain("<form");
			expect(html).not.toContain("Save settings");
			expect(html).not.toContain("Clear saved key");
			expect(html).toContain("configuration is unknown");
			if (error) expect(html).toContain(error);
		},
	);

	it("retains loaded stale values and the visible refresh error", () => {
		fixture.state = {
			loaded: true,
			error: "Unable to load embedding settings.",
			config: {
				base_url: "https://gateway.example",
				model: "active-model",
				dims: 512,
				backfill_enabled: true,
				api_key_set: true,
				api_key_suffix: "abcd",
			},
		};
		const html = renderToStaticMarkup(<EmbeddingPage />);
		expect(html).toContain("Unable to load embedding settings.");
		expect(html).toContain('value="active-model"');
		expect(html).toContain("abcd");
		expect(html).toContain("<form");
		expect(html).toContain("Save settings");
		expect(html).not.toContain("disabled=");
	});
});
