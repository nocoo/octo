import type { ToggleGroupProps } from "@nocoo/basalt/components/toggle-group";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MemoryTypeBadge, RecordTime, SpaceLink, ViewSwitch } from "./record-display";

const control = vi.hoisted(() => ({ change: (_value: string) => {} }));

it("renders space navigation as text and encodes the exact space filter", () => {
	for (const name of [undefined, "Shared notes"]) {
		const html = renderToStaticMarkup(
			<SpaceLink space="work & notes" {...(name ? { name } : {})} />,
		);
		expect(html).toContain('href="/memories?spaces=work+%26+notes"');
		expect(html).toContain(name ?? "work &amp; notes");
		expect(html).not.toContain("data-tag-color");
	}
});
vi.mock("@nocoo/basalt/components/toggle-group", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/toggle-group")>();
	return {
		...module,
		ToggleGroup: (props: ToggleGroupProps) => {
			if (props.type === "single" && props.onValueChange) control.change = props.onValueChange;
			return <module.ToggleGroup {...props} />;
		},
	};
});

it("renders the stored instant once in local time without a zone label", () => {
	const value = "2026-09-30T05:42:19Z";
	const html = renderToStaticMarkup(<RecordTime value={value} />);
	expect(html).toContain(`dateTime="${value}"`);
	expect(html).toContain("2026-09-30，05:42");
	expect(html).not.toContain("UTC");
	const epoch = renderToStaticMarkup(<RecordTime value={Date.parse(value)} />);
	expect(epoch).toContain('dateTime="2026-09-30T05:42:19.000Z"');
});

it("pairs semantic type colors with readable text, including unknown types", () => {
	for (const [type, color, label] of [
		["note", "info", "笔记"],
		["decision", "amber", "决策"],
		["missing", "slate", "未知类型"],
	]) {
		const html = renderToStaticMarkup(<MemoryTypeBadge type={type as string} />);
		expect(html).toContain(`data-tag-color="${color}"`);
		expect(html).toContain(label);
	}
});

it("gives inline view controls a label and prevents deselecting the required value", () => {
	const onChange = vi.fn();
	const html = renderToStaticMarkup(
		<ViewSwitch
			id="view-choice"
			label="View"
			value="list"
			options={[
				{ value: "list", label: "List" },
				{ value: "cards", label: "Cards" },
			]}
			onChange={onChange}
		/>,
	);
	expect(html).toContain('aria-label="View"');
	expect(html).toMatch(/<button[^>]*id="view-choice"/);
	expect(html).not.toContain("<legend");
	control.change("");
	expect(onChange).not.toHaveBeenCalled();
	control.change("cards");
	expect(onChange).toHaveBeenCalledWith("cards");
});
