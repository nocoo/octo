import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";

export const navigation = [
	{ href: "/", label: "总览", icon: "overview", group: "工作台" },
	{ href: "/memories", label: "记忆库", icon: "memories", group: "工作台" },
	{ href: "/search", label: "搜索", icon: "search", group: "工作台" },
	{ href: "/graph", label: "关系图", icon: "graph", group: "探索" },
	{ href: "/timeline", label: "时间线", icon: "timeline", group: "探索" },
	{ href: "/tags", label: "标签", icon: "tags", group: "管理" },
	{ href: "/spaces", label: "Space", icon: "spaces", group: "管理" },
	{ href: "/keys", label: "API Key", icon: "keys", group: "管理" },
	{ href: "/usage", label: "用量与健康", icon: "usage", group: "管理" },
	{ href: "/audit", label: "审计", icon: "audit", group: "管理" },
	{ href: "/trash", label: "回收站", icon: "trash", group: "管理" },
	{ href: "/settings/embedding", label: "向量模型", icon: "embedding", group: "系统" },
	{ href: "/settings", label: "设置", icon: "settings", group: "系统" },
] as const;

export function pageTitle(path: string): string {
	return (
		navigation.find(
			(item) => path === item.href || (item.href !== "/" && path.startsWith(`${item.href}/`)),
		)?.label ?? "页面不存在"
	);
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

export class ShellModel extends Store<{ email: string | null; error: string | null }> {
	constructor(private readonly api: AdminClient = adminApi) {
		super({ email: null, error: null });
	}
	async load(): Promise<void> {
		try {
			const identity = await this.api.request<{ email: string }>("/whoami");
			this.set({ email: identity.email, error: null });
		} catch {
			this.set({ email: null, error: "无法验证 Access 身份，请刷新后重试。" });
		}
	}
}
