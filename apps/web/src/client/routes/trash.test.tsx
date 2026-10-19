import { type Button, type ConfirmDialog, ThemeProvider } from "@nocoo/basalt";
import { Children, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, adminApi } from "../lib/api";
import { TrashModel, type TrashState } from "../viewmodels/trash";
import { TrashPage } from "./trash";

const snapshot = vi.hoisted(() => ({
	state: null as TrashState | null,
	dialog: null as Parameters<typeof ConfirmDialog>[0] | null,
	model: null as TrashModel | null,
	params: new URLSearchParams(),
	setParams: vi.fn(),
	restore: null as ComponentProps<typeof Button>["onClick"] | null,
	purge: null as ComponentProps<typeof Button>["onClick"] | null,
}));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: TrashModel) => {
		snapshot.model = model;
		if (snapshot.state) model.state = snapshot.state;
		return model.state;
	},
}));
vi.mock("react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("react-router")>()),
	useSearchParams: () => [snapshot.params, snapshot.setParams],
}));
vi.mock("@nocoo/basalt", async (importOriginal) => {
	const original = await importOriginal<typeof import("@nocoo/basalt")>();
	return {
		...original,
		Button: (props: ComponentProps<typeof Button>) => {
			if (Children.toArray(props.children).includes("恢复所选")) snapshot.restore = props.onClick;
			if (props["aria-label"] === "永久删除 记忆 a") snapshot.purge = props.onClick;
			return <original.Button {...props} />;
		},
		ConfirmDialog: (props: Parameters<typeof ConfirmDialog>[0]) => {
			snapshot.dialog = props;
			return props.open ? (
				<>
					{props.title}
					{props.description}
				</>
			) : null;
		},
	};
});

function render(url = "/trash") {
	snapshot.params = new URL(url, "https://octo.invalid").searchParams;
	snapshot.setParams.mockImplementation((next: (current: URLSearchParams) => URLSearchParams) => {
		snapshot.params = next(snapshot.params);
	});
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={[url]}>
				<TrashPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
}
const items = ["a", "b"].map((id) => ({
	id,
	title: `记忆 ${id}`,
	space: "work",
	tags: [],
	version: 1,
	created_at: "2026-10-17T00:00:00Z",
	deleted_at: "2026-10-18T00:00:00Z",
	event_time: null,
}));
afterEach(() => {
	snapshot.state = null;
	snapshot.dialog = null;
	snapshot.model = null;
	snapshot.restore = null;
	snapshot.purge = null;
	snapshot.setParams.mockReset();
	vi.restoreAllMocks();
});

describe("trash post-action selection", () => {
	const ids = ["a", "b", ...Array.from({ length: 24 }, (_, index) => `later-${index}`)];
	const page = (remaining: string[]) => ({
		items: remaining.slice(0, 25).map((id) => ({ ...items[0], id, title: `记忆 ${id}` })),
		total: remaining.length,
		next_cursor: remaining.length > 25 ? "next" : null,
	});
	function ready() {
		snapshot.state = {
			...new TrashModel().state,
			ready: true,
			memories: page(ids).items as TrashState["memories"],
			total: ids.length,
			nextCursor: "next",
		};
		return snapshot.state;
	}
	it("keeps a failed single purge local to the confirmation and restores its actual opener on cancel", async () => {
		ready().confirmation = {
			kind: "single",
			stage: "confirm",
			ids: ["a"],
			title: "记忆 a",
			count: 1,
			filters: {},
		};
		const request = vi
			.spyOn(adminApi, "request")
			.mockRejectedValueOnce(new ApiError(503, "unavailable"));
		render("/trash?all=1&excluded=b");
		const opener = { isConnected: true, focus: vi.fn() };
		snapshot.purge?.({ currentTarget: opener } as never);
		snapshot.model?.confirmTitle("记忆 a");
		const dialog = snapshot.dialog;
		await dialog?.onConfirm();
		const model = snapshot.model;
		expect(model?.state.confirmation).toMatchObject({
			kind: "single",
			stage: "confirm",
			title: "记忆 a",
		});
		expect(request).toHaveBeenCalledTimes(1);
		snapshot.state = model?.state ?? null;
		const html = render("/trash?all=1&excluded=b");
		expect(snapshot.dialog?.open).toBe(true);
		const description = renderToStaticMarkup(snapshot.dialog?.description);
		expect(description).toContain("永久删除失败：服务暂时不可用");
		expect(description).toContain('role="alert"');
		expect(description).toContain("text-basalt-danger");
		expect(html.match(/role="alert"/g)).toHaveLength(1);
		dialog?.onOpenChange(false);
		const event = { preventDefault: vi.fn() };
		dialog?.onCloseAutoFocus?.(event as never);
		expect(model?.state).toMatchObject({ confirmation: null, error: null });
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(opener.focus).toHaveBeenCalledOnce();
	});
	it.each(["unavailable", "changed total"])(
		"preserves all/excluded after restore preflight %s",
		async (failure) => {
			ready();
			const request = vi.spyOn(adminApi, "request");
			if (failure === "unavailable")
				request.mockRejectedValueOnce(new ApiError(503, "unavailable"));
			else request.mockResolvedValueOnce(page(ids.slice(1)));
			request.mockResolvedValueOnce(page(ids));
			render("/trash?all=1&excluded=b&theme=dark");
			const original = snapshot.params.toString();
			snapshot.restore?.({} as never);
			await vi.waitFor(() => expect(snapshot.setParams).toHaveBeenCalled());
			expect(snapshot.params.toString()).toBe(original);
			expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
		},
	);
	it.each(["", "&excluded=b"])(
		"preserves other selected pages after one purge with exclusions %s",
		async (excluded) => {
			ready().confirmation = {
				kind: "single",
				stage: "confirm",
				ids: ["a"],
				title: "记忆 a",
				count: 1,
				filters: {},
			};
			vi.spyOn(adminApi, "request")
				.mockResolvedValueOnce({ id: "a", purged: true })
				.mockResolvedValueOnce(page(ids.slice(1)));
			render(`/trash?all=1${excluded}`);
			const original = snapshot.params.toString();
			await snapshot.dialog?.onConfirm?.();
			expect(snapshot.params.toString()).toBe(original);
			expect(snapshot.model?.state.total).toBe(25);
		},
	);
	it("preserves untouched selected later pages after an empty partial stop", async () => {
		ready().confirmation = {
			kind: "empty",
			stage: "confirm",
			ids: [],
			count: ids.length,
			filters: {},
		};
		vi.spyOn(adminApi, "request")
			.mockResolvedValueOnce({
				results: [
					{ id: "a", ok: true },
					{ id: "b", ok: false, error: { code: "unavailable" } },
				],
				purged: 1,
				remaining: 25,
				next_cursor: null,
			})
			.mockResolvedValueOnce(page(ids.slice(1)));
		render("/trash?all=1&excluded=later-0");
		const original = snapshot.params.toString();
		await snapshot.dialog?.onConfirm?.();
		expect(snapshot.params.toString()).toBe(original);
		expect(snapshot.model?.state.failures.map((failure) => failure.id)).toEqual(["b"]);
	});
	it("reduces a fully resolved selected batch to failed ids only", async () => {
		ready().confirmation = {
			kind: "purge",
			stage: "confirm",
			ids: ["a", "b"],
			count: 2,
			filters: {},
		};
		vi.spyOn(adminApi, "request")
			.mockResolvedValueOnce({
				results: [
					{ id: "a", ok: true },
					{ id: "b", ok: false },
				],
			})
			.mockResolvedValueOnce(page(["b"]));
		render("/trash?all=1&excluded=later-0");
		await snapshot.dialog?.onConfirm?.();
		expect(snapshot.params.toString()).toBe("selected=b");
	});
	it("clears all matching only after a complete restore batch", async () => {
		ready();
		vi.spyOn(adminApi, "request")
			.mockResolvedValueOnce({
				...page(ids),
				items: ids.map((id) => ({ ...items[0], id })),
				next_cursor: null,
			})
			.mockResolvedValueOnce({
				results: ids.filter((id) => id !== "b").map((id) => ({ id, ok: true })),
			})
			.mockResolvedValueOnce(page(["b"]));
		render("/trash?all=1&excluded=b");
		snapshot.restore?.({} as never);
		await vi.waitFor(() => expect(snapshot.setParams).toHaveBeenCalled());
		expect(snapshot.params.toString()).toBe("");
	});
	it("keeps explicit untouched ids after a single purge", async () => {
		ready().confirmation = {
			kind: "single",
			stage: "confirm",
			ids: ["a"],
			count: 1,
			filters: {},
		};
		vi.spyOn(adminApi, "request")
			.mockResolvedValueOnce({ purged: true })
			.mockResolvedValueOnce(page(ids.slice(1)));
		render("/trash?selected=a&selected=b&selected=later-23");
		await snapshot.dialog?.onConfirm?.();
		expect(snapshot.params.toString()).toBe("selected=b&selected=later-23");
	});
	it("drops only successfully deleted exclusions after a single purge", async () => {
		ready().confirmation = {
			kind: "single",
			stage: "confirm",
			ids: ["a"],
			count: 1,
			filters: {},
		};
		vi.spyOn(adminApi, "request")
			.mockResolvedValueOnce({ purged: true })
			.mockResolvedValueOnce(page(ids.slice(1)));
		render("/trash?all=1&excluded=a&excluded=b");
		await snapshot.dialog?.onConfirm?.();
		expect(snapshot.params.toString()).toBe("all=1&excluded=b");
	});
	it("clears all matching after a complete empty rather than selecting new trash", async () => {
		ready().confirmation = {
			kind: "empty",
			stage: "confirm",
			ids: [],
			count: ids.length,
			filters: {},
		};
		vi.spyOn(adminApi, "request")
			.mockResolvedValueOnce({
				results: ids.map((id) => ({ id, ok: true })),
				purged: 26,
				remaining: 0,
				next_cursor: null,
			})
			.mockResolvedValueOnce(page(["new"]));
		render("/trash?all=1");
		await snapshot.dialog?.onConfirm?.();
		expect(snapshot.params.toString()).toBe("");
	});
});

describe("trash view", () => {
	it("does not claim empty trash before a successful read and shows Basalt error/retry", () => {
		expect(render()).toContain("正在加载回收站");
		expect(render()).not.toContain("当前筛选条件下，回收站为空。");
		snapshot.state = { ...new TrashModel().state, error: "请求失败，请稍后重试。" };
		const failed = render();
		expect(failed).toContain('role="alert"');
		expect(failed).toContain("重试");
		expect(failed).not.toContain("当前筛选条件下，回收站为空。");
	});
	it("renders Chinese header/page selection, exact server total and bulk bar with all-matching option", () => {
		snapshot.state = {
			...new TrashModel().state,
			ready: true,
			memories: items,
			total: 72,
			nextCursor: "next",
			spaces: [{ slug: "work", name: "工作" }],
		};
		const html = render("/trash?selected=a");
		expect(html).toContain('aria-label="全选当前页"');
		expect(html).toContain('aria-label="选择 记忆 a"');
		expect(html).toContain('data-state="indeterminate"');
		expect(html).toContain("已选择 1 条记忆");
		expect(html).toContain("选择全部 72 条");
		expect(html).toContain("恢复所选");
		expect(html).toContain("彻底删除所选");
		expect(html).toContain("清空回收站（72）");
		expect(html).toContain("下一页");
		expect(html).not.toContain("筛选仅作用于已加载");
		expect(html).not.toContain("Select a");
		expect(html).toContain("ps-basalt-table-edge");
	});
	it("shows all-matching count across pages and retains per-item failure feedback", () => {
		snapshot.state = {
			...new TrashModel().state,
			ready: true,
			memories: items,
			total: 72,
			failures: [{ id: "a", message: "服务暂时不可用，请稍后重试。" }],
			notice: "已恢复 1 / 2 条记忆",
		};
		const html = render("/trash?all=1&excluded=a");
		expect(html).toContain("已选择 71 条记忆");
		expect(html).toContain("服务暂时不可用，请稍后重试。");
		expect(html).toContain("已恢复 1 / 2 条记忆");
		expect(html).not.toContain("选择全部 72 条");
	});
	it.each(["purge", "empty"] as const)(
		"requires exact count and filter-scope danger confirmation for %s",
		(kind) => {
			snapshot.state = {
				...new TrashModel().state,
				ready: true,
				total: 37,
				confirmation: {
					kind,
					stage: "confirm",
					ids: ["a"],
					count: 37,
					filters: { q: "文档", space: "work" },
				},
			};
			const html = render();
			expect(html).toContain("37 条记忆");
			expect(html).toContain("空间「work」");
			expect(html).toContain("标题或标签包含「文档」");
			expect(html).toContain("无法恢复");
			expect(snapshot.dialog).toMatchObject({
				open: true,
				variant: "destructive",
				cancelLabel: "取消",
				loading: false,
			});
		},
	);
	it("freezes controls and displays server-confirmed progress while destructive work runs", () => {
		snapshot.state = {
			...new TrashModel().state,
			ready: true,
			busy: true,
			memories: items,
			total: 72,
			progress: { processed: 25, total: 72 },
			confirmation: { kind: "empty", stage: "confirm", ids: [], count: 72, filters: {} },
		};
		const html = render("/trash?all=1");
		expect(html).toContain("已处理 25 / 72 条记忆");
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="全选当前页"/);
		expect(snapshot.dialog?.loading).toBe(true);
	});
	it("renders legitimate empty and cached-error states plus separate space lookup errors", () => {
		snapshot.state = { ...new TrashModel().state, ready: true };
		expect(render()).toContain("当前筛选条件下，回收站为空。");
		snapshot.state = {
			...snapshot.state,
			memories: items,
			total: 2,
			error: "刷新失败",
			spacesError: "空间加载失败",
		};
		const html = render();
		expect(html).toContain("记忆 a");
		expect(html).toContain("刷新失败");
		expect(html).toContain("空间加载失败");
	});
});
