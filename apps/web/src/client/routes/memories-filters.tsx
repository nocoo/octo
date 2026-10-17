import { Button, Field, Input } from "@nocoo/basalt";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { Grid } from "@nocoo/basalt/components/grid";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { Check, Filter, FilterX } from "lucide-react";
import { useState } from "react";
import { filterKeys, memoryTypeLabels } from "../viewmodels/memories";
import "../components/layout/markdown.css";

const choiceLabels: Record<string, string> = {
	...memoryTypeLabels,
	created: "创建时间",
	updated: "更新时间",
	hybrid: "混合搜索",
	fts: "全文搜索",
	vector: "向量搜索",
	rrf: "倒数排名融合（RRF）",
	weighted: "加权融合",
};

export function Choice({
	label,
	name,
	value,
	options,
	optionLabels = choiceLabels,
	onChange,
}: {
	label: string;
	name?: string;
	value: string;
	options: readonly string[];
	optionLabels?: Readonly<Record<string, string>>;
	onChange?: (value: string) => void;
}) {
	const [selected, setSelected] = useState(value);
	return (
		<Field label={label} {...(name ? { htmlFor: name } : {})}>
			<Select
				{...(name ? { name } : {})}
				value={onChange ? value : selected}
				onValueChange={(next) => {
					setSelected(next);
					onChange?.(next);
				}}
			>
				<SelectTrigger id={name} aria-label={label}>
					<SelectValue>
						{optionLabels[onChange ? value : selected] ?? (onChange ? value : selected)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem value={option} key={option}>
							{optionLabels[option] ?? option}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	);
}

export function MemoryFilters({
	params,
	onChange,
}: {
	params: URLSearchParams;
	onChange: (params: URLSearchParams) => void;
}) {
	const [open, setOpen] = useState(filterKeys.some((key) => params.has(key)));
	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			style={{ display: "grid", gap: "var(--basalt-space-layout)" }}
		>
			<CollapsibleTrigger asChild>
				<Button variant="outline" aria-label="展开或收起记忆筛选">
					<Filter aria-hidden="true" />
					筛选{filterKeys.some((key) => params.has(key)) ? "（已启用）" : ""}
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent unstyled>
				<form
					key={params.toString()}
					style={{ display: "grid", gap: "var(--basalt-space-layout)" }}
					aria-label="记忆筛选"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const next = new URLSearchParams(params);
						for (const key of filterKeys) {
							const value = String(form.get(key) ?? "").trim();
							if (value) next.set(key, value);
							else next.delete(key);
						}
						if (!next.get("time_from") && !next.get("time_to")) next.delete("time_field");
						next.delete("cursor");
						next.delete("selected");
						onChange(next);
					}}
				>
					<Grid
						columns={1}
						style={{
							gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
							alignItems: "end",
						}}
					>
						{[
							["spaces", "空间"],
							["tags_all", "包含全部标签"],
							["tags_any", "包含任一标签"],
							["types", "类型"],
							["sources", "来源密钥 ID"],
						].map(([name, label]) => (
							<Field
								key={name}
								label={label}
								htmlFor={`filter-${name}`}
								hint="多个值用英文逗号分隔"
							>
								<Input
									id={`filter-${name}`}
									name={name}
									defaultValue={params.get(name as string) ?? ""}
								/>
							</Field>
						))}
						<Choice
							label="时间字段"
							name="time_field"
							value={params.get("time_field") ?? "updated"}
							options={["created", "updated", "event"]}
							optionLabels={{ created: "创建时间", updated: "更新时间", event: "事件时间" }}
						/>
						{[
							["time_from", "起始时间（UTC）"],
							["time_to", "结束时间（UTC）"],
						].map(([name, label]) => (
							<Field key={name} label={label} htmlFor={`filter-${name}`} hint="ISO 8601 UTC 格式">
								<Input
									id={`filter-${name}`}
									name={name}
									placeholder="2026-01-01T00:00:00Z"
									defaultValue={params.get(name as string) ?? ""}
								/>
							</Field>
						))}
						{[
							["importance_min", "重要性下限"],
							["importance_max", "重要性上限"],
						].map(([name, label]) => (
							<Field key={name} label={label} htmlFor={`filter-${name}`}>
								<Input
									id={`filter-${name}`}
									name={name}
									type="number"
									min={0}
									max={1}
									step={0.01}
									defaultValue={params.get(name as string) ?? ""}
								/>
							</Field>
						))}
					</Grid>
					<Grid
						columns={1}
						gap="sm"
						style={{
							gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), max-content))",
							alignItems: "center",
						}}
					>
						<Button type="submit">
							<Check aria-hidden="true" />
							应用筛选
						</Button>
						<Button
							type="button"
							variant="ghost"
							onClick={() => {
								const next = new URLSearchParams(params);
								for (const key of filterKeys) next.delete(key);
								next.delete("cursor");
								next.delete("selected");
								onChange(next);
							}}
						>
							<FilterX aria-hidden="true" />
							清除筛选
						</Button>
					</Grid>
				</form>
			</CollapsibleContent>
		</Collapsible>
	);
}
