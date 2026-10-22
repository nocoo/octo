import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkClientDesign, main, runGateClientDesign } from "./gate-client-design";

describe("Basalt client layout boundary", () => {
	it.each(["div", "section", "article", "aside", "main", "nav", "header", "footer", "h2"])(
		"rejects handwritten %s containers",
		(tag) => expect(checkClientDesign("page.tsx", `const page = <${tag} />`)).toHaveLength(1),
	);
	it("accepts package layout and semantic content rather than string examples", () => {
		expect(
			checkClientDesign(
				"page.tsx",
				'const page = <Grid gap="sm"><SectionRule title="标题"><LayerCard><form><p>内容</p><span>值</span></form></LayerCard></SectionRule></Grid>; const example = "<div />"',
			),
		).toEqual([]);
	});
	it.each([
		"const page = <Grid style={{ padding: 12 }} />",
		'const page = <Grid style={{ gap: "1rem" }} />',
		'const page = <Grid style={{ "padding": "1rem" }} />',
		'const page = <Grid className={active ? "gap-4" : "gap-2"} />',
		'const page = <Grid className="md:px-4 gap-[12px]" />',
		"const page = <input />",
		"const page = <button />",
		"const page = <select />",
		"const page = <details />",
	])("rejects raw controls and spacing: %s", (source) => {
		expect(checkClientDesign("page.tsx", source).length).toBeGreaterThan(0);
	});
	it("allows a hidden native upload input and token spacing", () => {
		expect(
			checkClientDesign(
				"editor.tsx",
				'const page = <><input type="file" hidden /><Grid style={{gap:"var(--basalt-space-layout)"}} /></>',
			),
		).toEqual([]);
		expect(
			checkClientDesign(
				"page.css",
				".page { gap: var(--basalt-space-layout); margin-inline:auto; }",
			),
		).toEqual([]);
	});
	it.each([
		`const page = <Grid className={\`gap-4 \${active}\`} />`,
		"const layout = { padding: 12 }; const page = <Grid style={layout} />",
		"const layout = { padding: 12 }; const page = <Grid style={{ ...layout }} />",
		"const page = <Grid style={{ [property]: 12 }} />",
	])("fails closed for indirect or template spacing: %s", (source) => {
		expect(checkClientDesign("page.tsx", source).length).toBeGreaterThan(0);
	});
	it.each([
		"padding:12px",
		"margin-top: 1rem",
		"gap: 0",
		"row-gap: calc(2 * 8px)",
		"padding:var(--custom-spacing)",
	])("rejects raw CSS %s", (declaration) => {
		expect(checkClientDesign("page.css", `.page { ${declaration}; }`)).toHaveLength(1);
	});
	it("ignores comments and keeps typography and canvas dimensions outside spacing rules", () => {
		expect(
			checkClientDesign(
				"page.css",
				"/* padding: 4px; */ .graph { height: 360px; width:100%; margin:unset; }",
			),
		).toEqual([]);
	});
	it("fails closed for invalid JSX", () => {
		expect(checkClientDesign("page.tsx", "const page = <Grid").length).toBeGreaterThan(0);
	});
	it("scans source/CSS while excluding only tests and fails on an empty tree", async () => {
		const root = await mkdtemp(join(tmpdir(), "octo-design-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await main(root)).toBe(1);
			await mkdir(join(root, "routes"));
			await writeFile(join(root, "routes/page.tsx"), "export const Page = () => <Grid />");
			await writeFile(join(root, "routes/page.test.tsx"), "<div />");
			await writeFile(join(root, "notes.md"), "<div />");
			expect(await runGateClientDesign(root)).toBe(0);
			await writeFile(join(root, "routes/page.css"), ".bad {padding:4px}");
			expect(await main(root)).toBe(1);
			expect(error).toHaveBeenCalled();
		} finally {
			log.mockRestore();
			error.mockRestore();
			await rm(root, { recursive: true, force: true });
		}
	});
});
