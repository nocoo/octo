import { Button, Checkbox, Field, Input, Switch } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import { Select } from "@nocoo/basalt/components/select";
import {
	Children,
	type ComponentProps,
	type ElementType,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyMetadata } from "../viewmodels/operations-keys";
import { KeyForm, type KeyFormProps } from "./key-form";

const hooks = vi.hoisted(() => ({ active: false, index: 0, values: [] as unknown[] }));
vi.mock("react", async (original) => {
	const react = await original<typeof import("react")>();
	const { useId: realId, useState: realState, useRef: realRef } = react;
	return {
		...react,
		useId: () => (hooks.active ? "key-form" : realId()),
		useRef: (value: unknown) => (hooks.active ? { current: value } : realRef(value)),
		useState: (initial: unknown) => {
			if (!hooks.active) return realState(initial);
			const index = hooks.index++;
			if (!(index in hooks.values))
				hooks.values[index] = typeof initial === "function" ? initial() : initial;
			return [
				hooks.values[index],
				(next: unknown) => {
					hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next;
				},
			];
		},
	};
});

function elements(node: ReactNode): ReactElement[] {
	return Children.toArray(node).flatMap((child) =>
		isValidElement<{ children?: ReactNode }>(child)
			? [child, ...elements(child.props.children)]
			: [],
	);
}
function control<T extends ElementType>(
	tree: ReactNode,
	type: T,
	predicate: (props: ComponentProps<T>) => boolean = () => true,
): ReactElement<ComponentProps<T>> {
	const found = elements(tree).find(
		(element) => element.type === type && predicate(element.props as ComponentProps<T>),
	);
	expect(found).toBeDefined();
	return found as ReactElement<ComponentProps<T>>;
}

const spaces = [
	{ id: "space-1", name: "设计资料", slug: "design" },
	{ id: "space-2", name: "工程知识", slug: "engineering" },
];
const existing: KeyMetadata = {
	id: "key-1",
	name: "project-agent",
	role: "project",
	ops: "r,w,u,d",
	scope: "own",
	space_ids: [],
	own_entries_only: false,
	auto_own_space: true,
	expires_at: null,
	revoked_at: null,
	last_used_at: null,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};
function setup(overrides: Partial<KeyFormProps> = {}) {
	const props = {
		initial: null,
		pending: false,
		error: null,
		fieldErrors: {},
		spaces,
		spacesLoading: false,
		spacesLoaded: true,
		spacesError: null,
		onLoadSpaces: vi.fn(),
		onClearErrors: vi.fn(),
		onClearFieldError: vi.fn(),
		onSubmit: vi.fn(async () => {}),
		onCancel: vi.fn(),
		...overrides,
	};
	const render = () => {
		hooks.active = true;
		hooks.index = 0;
		try {
			return KeyForm(props);
		} finally {
			hooks.active = false;
		}
	};
	const submit = async (tree: ReactNode) => {
		const preventDefault = vi.fn();
		await control(tree, "form").props.onSubmit?.({ preventDefault } as never);
		expect(preventDefault).toHaveBeenCalledOnce();
	};
	return { props, render, submit };
}

beforeEach(() => {
	hooks.active = false;
	hooks.index = 0;
	hooks.values = [];
});

describe("key form", () => {
	it("keeps partial datetime input invalid instead of clearing the expiry", async () => {
		const { render, submit, props } = setup();
		const tree = render();
		const input = control(tree, Input, (props) => props.type === "datetime-local");
		expect(input.props.ref).toBeDefined();
		const ref = input.props.ref as { current: unknown };
		ref.current = { validity: { badInput: true } };
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ expires_at: "" }));
	});
	it("uses application validation and shows the fixed project auto-space permission", async () => {
		const { render, submit, props } = setup();
		let tree = render();
		expect(control(tree, "form").props.noValidate).toBe(true);
		expect(control(tree, Switch).props).toMatchObject({ checked: true, disabled: true });
		expect(renderToStaticMarkup(tree)).toContain("项目模板固定开启");
		control(tree, Input).props.onChange?.({ target: { value: "project-bot" } } as never);
		tree = render();
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "project-bot",
				role: "project",
				permissions: expect.objectContaining({ scope: "own", auto_own_space: true }),
			}),
		);
	});

	it("selects existing space ids with visible names and slugs, never comma-separated text", async () => {
		const { render, submit, props } = setup();
		let tree = render();
		control(tree, Input).props.onChange?.({ target: { value: "custom-bot" } } as never);
		control(tree, Select).props.onValueChange?.("custom");
		tree = render();
		const picker = control(tree, MultiSelect);
		expect(picker.props.options).toEqual([
			{ value: "space-1", label: "设计资料（design）" },
			{ value: "space-2", label: "工程知识（engineering）" },
		]);
		expect(picker.props).toMatchObject({
			label: "空间",
			searchPlaceholder: "搜索空间名称或标识",
			removeLabel: "移除",
		});
		expect(elements(tree).filter((element) => element.type === Input)).toHaveLength(2);
		picker.props.onValueChange?.(["space-2", "space-1"]);
		tree = render();
		control(tree, Checkbox.Group).props.onValueChange?.(["w", "r"]);
		tree = render();
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "custom",
				permissions: expect.objectContaining({
					ops: "r,w",
					space_ids: ["space-2", "space-1"],
					scope: "spaces",
				}),
			}),
		);
		expect(props.onClearFieldError).toHaveBeenCalledWith("space_ids");
		expect(props.onClearFieldError).toHaveBeenCalledWith("ops");
	});

	it("retains selected ids when editing a custom key and submits an immutable name for validation", async () => {
		const { render, submit, props } = setup({
			initial: { ...existing, role: "custom", scope: "spaces", space_ids: ["space-1"] },
		});
		const tree = render();
		expect(control(tree, Input).props.disabled).toBe(true);
		expect(control(tree, MultiSelect).props.value).toEqual(["space-1"]);
		expect(renderToStaticMarkup(tree)).toContain("设计资料（design）");
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ name: "project-agent", role: "custom" }),
		);
	});
	it("retains selected ids when a space slug and display name change", async () => {
		const { props, render, submit } = setup({
			initial: { ...existing, role: "custom", scope: "spaces", space_ids: ["space-1"] },
		});
		expect(control(render(), MultiSelect).props.value).toEqual(["space-1"]);
		props.spaces = [{ ...spaces[0], id: "space-1", name: "新设计资料", slug: "new-design" }];
		const tree = render();
		expect(control(tree, MultiSelect).props).toMatchObject({
			value: ["space-1"],
			options: [{ value: "space-1", label: "新设计资料（new-design）" }],
		});
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ permissions: expect.objectContaining({ space_ids: ["space-1"] }) }),
		);
	});

	it("edits project expiry without changing its immutable name or fixed template", async () => {
		const { props, render, submit } = setup({ initial: existing });
		let tree = render();
		expect(control(tree, Input).props).toMatchObject({
			value: "project-agent",
			disabled: true,
		});
		expect(control(tree, Switch).props).toMatchObject({ checked: true, disabled: true });
		control(tree, Input, (props) => props.type === "datetime-local").props.onChange?.({
			target: { value: "2030-12-01T10:30" },
		} as never);
		tree = render();
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith({
			name: "project-agent",
			role: "project",
			expires_at: new Date("2030-12-01T10:30").toISOString(),
			permissions: {
				ops: "r,w,u,d",
				scope: "own",
				space_ids: [],
				own_entries_only: false,
				auto_own_space: true,
			},
		});
		expect(props.onClearFieldError).toHaveBeenCalledWith("expires_at");
	});

	it("keeps the fixed project switch checked but disabled with a hint for invalid existing names", () => {
		const { render } = setup({ initial: { ...existing, name: "Invalid Project" } });
		const tree = render();
		expect(control(tree, Switch).props).toMatchObject({ checked: true, disabled: true });
		expect(renderToStaticMarkup(tree)).toContain("当前名称不符合规则");
	});

	it("clears scope-dependent errors and omits selected ids after changing scope", async () => {
		const { props, render, submit } = setup({
			initial: { ...existing, role: "custom", scope: "spaces", space_ids: ["space-1"] },
		});
		let tree = render();
		control(tree, Select, (props) => props.value === "spaces").props.onValueChange?.("all");
		expect(props.onClearFieldError).toHaveBeenCalledWith("scope");
		expect(props.onClearFieldError).toHaveBeenCalledWith("space_ids");
		tree = render();
		expect(elements(tree).some((element) => element.type === MultiSelect)).toBe(false);
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				permissions: expect.objectContaining({ scope: "all", space_ids: [] }),
			}),
		);
	});

	it.each(["Invalid Name", "has--gap", "a".repeat(65)])(
		"disables auto-space for an invalid immutable name: %s",
		(name) => {
			const { render } = setup({ initial: { ...existing, name, role: "custom" } });
			const tree = render();
			const field = control(tree, Field, (props) => props.label === "自动创建自有空间");
			expect(control(field, Switch).props.disabled).toBe(true);
			expect(field.props.hint).toContain("名称须为 1 至 64 位小写字母、数字与单连字符");
		},
	);

	it("turns custom auto-space off when a once-valid name becomes invalid", async () => {
		const { render, submit, props } = setup();
		let tree = render();
		control(tree, Select).props.onValueChange?.("custom");
		control(tree, Input).props.onChange?.({ target: { value: "valid-bot" } } as never);
		tree = render();
		control(
			tree,
			Switch,
			(props) => props.id?.endsWith("-auto-space") === true,
		).props.onCheckedChange?.(true);
		tree = render();
		control(tree, Input).props.onChange?.({ target: { value: "Invalid Name" } } as never);
		tree = render();
		expect(
			control(tree, Switch, (props) => props.id?.endsWith("-auto-space") === true).props,
		).toMatchObject({ checked: false, disabled: true });
		await submit(tree);
		expect(props.onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ permissions: expect.objectContaining({ auto_own_space: false }) }),
		);
	});

	it("renders Basalt field errors beside controls and a Basalt alert summary", () => {
		const { render } = setup({
			initial: { ...existing, role: "custom", scope: "spaces" },
			error: "请检查标记的字段。",
			fieldErrors: {
				name: "名称已被使用。",
				role: "请选择有效的角色。",
				ops: "请至少选择一项操作。",
				scope: "请选择空间范围。",
				space_ids: "请至少选择一个空间。",
				own_entries_only: "权限值无效。",
				auto_own_space: "无法创建空间。",
				expires_at: "请填写有效的到期时间。",
			},
		});
		const tree = render();
		expect(control(tree, Banner).props).toMatchObject({
			variant: "error",
			role: "alert",
			description: "请检查标记的字段。",
		});
		for (const [label, error] of [
			["代理名称", "名称已被使用。"],
			["角色模板", "请选择有效的角色。"],
			["空间范围", "请选择空间范围。"],
			["空间", "请至少选择一个空间。"],
			["仅更新或删除此代理的记忆", "权限值无效。"],
			["自动创建自有空间", "无法创建空间。"],
			["到期时间", "请填写有效的到期时间。"],
		])
			expect(control(tree, Field, (props) => props.label === label).props.error).toBe(error);
		expect(control(tree, Checkbox.Group).props.error).toBe("请至少选择一项操作。");
		const html = renderToStaticMarkup(tree);
		expect(html).toContain('aria-invalid="true"');
		expect(html).toContain("名称已被使用。");
		expect(html).toContain("basalt-banner");
	});

	it("shows loading, retry and successful empty space states without claiming a failed read is empty", () => {
		const { props, render } = setup({
			initial: { ...existing, role: "drop", scope: "spaces" },
			spaces: [],
			spacesLoaded: false,
			spacesLoading: true,
		});
		let tree = render();
		expect(control(tree, MultiSelect).props.disabled).toBe(true);
		expect(renderToStaticMarkup(tree)).toContain("正在加载空间");
		Object.assign(props, { spacesLoading: false, spacesError: "无法加载空间。" });
		tree = render();
		expect(renderToStaticMarkup(tree)).not.toContain("暂无可授权的空间");
		control(control(tree, Banner).props.action, Banner.Action).props.onClick?.({} as never);
		expect(props.onLoadSpaces).toHaveBeenCalledOnce();
		Object.assign(props, { spacesLoaded: true, spacesError: null });
		expect(renderToStaticMarkup(render())).toContain("暂无可授权的空间");
	});

	it("clears stale form errors on role changes and related field errors on name edits", () => {
		const { props, render } = setup();
		let tree = render();
		control(tree, Select).props.onValueChange?.("custom");
		expect(props.onClearErrors).toHaveBeenCalledOnce();
		tree = render();
		control(tree, Input).props.onChange?.({ target: { value: "new-name" } } as never);
		expect(props.onClearFieldError).toHaveBeenCalledWith("name");
		expect(props.onClearFieldError).toHaveBeenCalledWith("auto_own_space");
	});

	it("offers space refresh after stale-id errors and links the error to the picker group", () => {
		const { props, render } = setup({
			initial: { ...existing, role: "custom", scope: "spaces", space_ids: ["space-1"] },
			fieldErrors: { space_ids: "空间可能已删除，请刷新列表。" },
		});
		const tree = render();
		control(tree, Button, (props) => props.children === "刷新空间").props.onClick?.({} as never);
		expect(props.onLoadSpaces).toHaveBeenCalledOnce();
		control(tree, MultiSelect).props.onValueChange?.(["space-2"]);
		expect(props.onClearFieldError).toHaveBeenCalledWith("space_ids");
		const html = renderToStaticMarkup(tree);
		expect(html).toMatch(/role="group"[^>]*aria-label="空间"[^>]*aria-invalid="true"/);
		expect(html).toMatch(/aria-describedby="[^"]+-error"/);
	});
});
