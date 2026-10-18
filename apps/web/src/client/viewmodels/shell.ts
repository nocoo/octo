import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";

export const navigation = [
	{ href: "/", label: "总览", icon: "overview", group: "工作台" },
	{ href: "/memories", label: "记忆库", icon: "memories", group: "工作台" },
	{ href: "/search", label: "搜索", icon: "search", group: "工作台" },
	{ href: "/graph", label: "关系图", icon: "graph", group: "探索" },
	{ href: "/timeline", label: "时间线", icon: "timeline", group: "探索" },
	{ href: "/tags", label: "标签", icon: "tags", group: "管理" },
	{ href: "/spaces", label: "空间", icon: "spaces", group: "管理" },
	{ href: "/keys", label: "接口密钥", icon: "keys", group: "管理" },
	{ href: "/usage", label: "每日用量", icon: "usage", group: "管理" },
	{ href: "/audit", label: "审计", icon: "audit", group: "管理" },
	{ href: "/trash", label: "回收站", icon: "trash", group: "管理" },
	{ href: "/settings/embedding", label: "向量模型", icon: "embedding", group: "系统" },
	{ href: "/settings", label: "设置", icon: "settings", group: "系统" },
] as const;

export function headerCrumbs(path: string): { href?: string; label: string }[] {
	const memory = path.match(/^\/memories\/([^/]+)(?:\/(edit|history))?\/?$/);
	if (memory) {
		return [
			{ href: "/memories", label: "记忆库" },
			...(memory[2] ? [{ href: `/memories/${memory[1]}`, label: "记忆详情" }] : []),
			{
				label:
					memory[2] === "edit" ? "编辑记忆" : memory[2] === "history" ? "版本历史" : "记忆详情",
			},
		];
	}
	return [
		...(path === "/" ? [] : [{ href: "/", label: "工作台" }]),
		{ label: navigation.find((item) => path === item.href)?.label ?? "页面不存在" },
	];
}

export function pageTitle(path: string): string {
	return headerCrumbs(path).at(-1)?.label ?? "页面不存在";
}

export function initials(name: string): string {
	const words = name.trim().split(/\s+/);
	return (
		words.length > 1
			? words
					.slice(0, 2)
					.map((word) => word[0])
					.join("")
			: name.trim().slice(0, 2)
	).toUpperCase();
}

export function shortcut(
	key: string,
	modifier: boolean,
	editable: boolean,
): "palette" | "search" | null {
	if (modifier && key === "k") return "palette";
	if (!editable && !modifier && key === "/") return "search";
	return null;
}

type ShellState = {
	email: string | null;
	name: string | null;
	avatar: string | null;
	error: string | null;
};

export class ShellModel extends Store<ShellState> {
	constructor(private readonly api: AdminClient = adminApi) {
		super({ email: null, name: null, avatar: null, error: null });
	}
	async load(): Promise<void> {
		try {
			const identity = await this.api.request<{
				email: string;
				name: string | null;
				avatar: string | null;
			}>("/whoami");
			this.set({
				email: identity.email,
				name: identity.name,
				avatar: identity.avatar,
				error: null,
			});
		} catch {
			this.set({
				email: null,
				name: null,
				avatar: null,
				error: "无法验证 Access 身份，请刷新后重试。",
			});
		}
	}
}
