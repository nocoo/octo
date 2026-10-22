import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { filterKeys, memoryTypeLabels } from "./memories";

type FilterKey = (typeof filterKeys)[number];
type SpaceOption = { slug: string; name: string };
type ChoiceOption = { value: string; label: string };

export const filterLabels: Record<FilterKey, string> = {
	spaces: "空间",
	tags_all: "包含全部标签",
	tags_any: "包含任一标签",
	types: "类型",
	sources: "来源密钥 ID",
	time_field: "时间字段",
	time_from: "起始时间（UTC）",
	time_to: "结束时间（UTC）",
	importance_min: "重要性下限",
	importance_max: "重要性上限",
};
export const timeFieldLabels: Record<string, string> = {
	created: "创建时间",
	updated: "更新时间",
	event: "事件时间",
};

export function filterValues(value: string | null): string[] {
	return (value ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

export function filterChoices(
	options: ChoiceOption[],
	selected: string[],
	query: string,
): ChoiceOption[] {
	const choices = new Map(options.map((option) => [option.value, option]));
	const custom = query.trim();
	const knownLabel = options.some(
		(option) => option.label.toLocaleLowerCase() === custom.toLocaleLowerCase(),
	);
	for (const value of [
		...selected,
		...(custom && !custom.includes(",") && !knownLabel ? [custom] : []),
	]) {
		if (!choices.has(value)) choices.set(value, { value, label: value });
	}
	return [...choices.values()];
}

function resetFilterPaging(params: URLSearchParams): URLSearchParams {
	if (!params.get("time_from") && !params.get("time_to")) params.delete("time_field");
	params.delete("cursor");
	params.delete("selected");
	return params;
}

export function applyMemoryFilters(params: URLSearchParams, form: FormData): URLSearchParams {
	const next = new URLSearchParams(params);
	for (const key of filterKeys) {
		const value = form.getAll(key).map(String).join(",").trim();
		if (value) next.set(key, value);
		else next.delete(key);
	}
	return resetFilterPaging(next);
}

export function removeMemoryFilter(params: URLSearchParams, key?: FilterKey): URLSearchParams {
	const next = new URLSearchParams(params);
	for (const name of key ? [key] : filterKeys) next.delete(name);
	return resetFilterPaging(next);
}

export function memoryFilterChips(params: URLSearchParams, spaces: SpaceOption[]) {
	return filterKeys
		.filter((key) => params.get(key))
		.map((key) => {
			const raw = params.get(key) as string;
			const value =
				key === "spaces"
					? filterValues(raw)
							.map((slug) => spaces.find((space) => space.slug === slug)?.name ?? slug)
							.join("、")
					: key === "types"
						? filterValues(raw)
								.map((type) => memoryTypeLabels[type] ?? type)
								.join("、")
						: key === "time_field"
							? (timeFieldLabels[raw] ?? raw)
							: raw;
			return { key, label: filterLabels[key], value };
		});
}

export class MemoryFilterOptionsModel extends Store<{
	spaces: SpaceOption[];
	loading: boolean;
	error: string | null;
}> {
	constructor(private readonly api: AdminClient = adminApi) {
		super({ spaces: [], loading: false, error: null });
	}
	async load(): Promise<void> {
		this.set({ loading: true, error: null });
		try {
			const result = await this.api.request<{ items: SpaceOption[] }>("/spaces");
			this.set({ spaces: result.items });
		} catch {
			this.set({ error: "空间选项加载失败，仍可输入标识筛选。" });
		} finally {
			this.set({ loading: false });
		}
	}
}
