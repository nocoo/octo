import { Button, Field, Input } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { FilterBar, FilterChip } from "@nocoo/basalt/components/filter-bar";
import { Grid } from "@nocoo/basalt/components/grid";
import { MultiSelect, type MultiSelectOption } from "@nocoo/basalt/components/multi-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { Check, Filter } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useModel } from "../components/layout/use-model";
import { filterKeys, memoryTypeLabels } from "../viewmodels/memories";
import {
	applyMemoryFilters,
	filterChoices,
	filterValues,
	MemoryFilterOptionsModel,
	memoryFilterChips,
	removeMemoryFilter,
	timeFieldLabels,
} from "../viewmodels/memory-filters";
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
const advancedFilterKeys = filterKeys.filter((key) => key !== "spaces" && key !== "types");

export function Choice({
	label,
	name,
	form,
	value,
	options,
	optionLabels = choiceLabels,
	onChange,
	inline = false,
}: {
	label: string;
	name?: string;
	form?: string;
	value: string;
	options: readonly string[];
	optionLabels?: Readonly<Record<string, string>>;
	onChange?: (value: string) => void;
	inline?: boolean;
}) {
	const [selected, setSelected] = useState(value);
	return (
		<Select
			{...(name ? { name } : {})}
			{...(form ? { form } : {})}
			value={onChange ? value : selected}
			onValueChange={(next) => {
				setSelected(next);
				onChange?.(next);
			}}
		>
			<Field
				label={label}
				{...(inline ? { className: "octo-inline-choice" } : {})}
				{...(name ? { htmlFor: name } : {})}
			>
				<SelectTrigger aria-label={label}>
					<SelectValue>
						{optionLabels[onChange ? value : selected] ?? (onChange ? value : selected)}
					</SelectValue>
				</SelectTrigger>
			</Field>
			<SelectContent>
				{options.map((option) => (
					<SelectItem value={option} key={option}>
						{optionLabels[option] ?? option}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function FilterSelect({
	name,
	label,
	values,
	options,
	loading = false,
}: {
	name: string;
	label: string;
	values: string[];
	options: MultiSelectOption[];
	loading?: boolean;
}) {
	const [selected, setSelected] = useState(values);
	const [query, setQuery] = useState("");
	return (
		<Grid columns={1} className="octo-filter-choice">
			<span className="text-basalt-base font-medium" aria-hidden="true">
				{label}
			</span>
			<MultiSelect
				name={name}
				label={label}
				value={selected}
				onValueChange={setSelected}
				query={query}
				onQueryChange={setQuery}
				options={filterChoices(options, selected, query)}
				loading={loading}
				showChips={false}
				placeholder={`全部${label}`}
				searchPlaceholder="搜索或输入标识"
				emptyLabel="没有匹配项，请输入完整标识"
				loadingLabel="正在加载选项…"
				removeLabel="移除"
				formatSelectionCount={(count) => `已选 ${count} 项`}
			/>
		</Grid>
	);
}

export function MemoryFilters({
	params,
	onChange,
	children,
}: {
	params: URLSearchParams;
	onChange: (params: URLSearchParams) => void;
	children?: ReactNode;
}) {
	const hasAdvancedFilters = advancedFilterKeys.some((key) => params.get(key));
	const [open, setOpen] = useState(hasAdvancedFilters);
	useEffect(() => {
		if (hasAdvancedFilters) setOpen(true);
	}, [hasAdvancedFilters]);
	const model = useMemo(() => new MemoryFilterOptionsModel(), []);
	const state = useModel(model);
	useEffect(() => {
		void model.load();
	}, [model]);
	const valuesHint = useId();
	const chips = memoryFilterChips(params, state.spaces);
	const advancedCount = chips.filter(
		(chip) => chip.key !== "spaces" && chip.key !== "types",
	).length;
	return (
		<Grid columns={1} gap="md">
			{children}
			<Collapsible open={open} onOpenChange={setOpen}>
				<form
					key={params.toString()}
					className="octo-memory-filters"
					aria-label="记忆筛选"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						if (!event.currentTarget.checkValidity()) {
							flushSync(() => setOpen(true));
							event.currentTarget.reportValidity();
							return;
						}
						onChange(applyMemoryFilters(params, new FormData(event.currentTarget)));
					}}
				>
					<FilterBar
						label="常用记忆筛选"
						className="octo-memory-filter-bar"
						active={chips.length > 0}
						clearLabel="清除筛选"
						onClear={() => onChange(removeMemoryFilter(params))}
						chips={
							chips.length > 0
								? chips.map((chip) => (
										<FilterChip
											key={chip.key}
											label={chip.label}
											value={chip.value}
											removeLabel={`清除${chip.label}筛选`}
											onRemove={() => onChange(removeMemoryFilter(params, chip.key))}
										/>
									))
								: undefined
						}
					>
						<FilterSelect
							name="spaces"
							label="空间"
							values={filterValues(params.get("spaces"))}
							options={state.spaces.map((space) => ({
								value: space.slug,
								label: space.name,
								description: space.slug,
							}))}
							loading={state.loading}
						/>
						<FilterSelect
							name="types"
							label="类型"
							values={filterValues(params.get("types"))}
							options={Object.entries(memoryTypeLabels).map(([value, label]) => ({ value, label }))}
						/>
						<CollapsibleTrigger asChild>
							<Button variant="outline" aria-label="展开或收起记忆筛选">
								<Filter aria-hidden="true" />
								更多筛选{advancedCount ? `（${advancedCount}）` : ""}
							</Button>
						</CollapsibleTrigger>
						<Button type="submit">
							<Check aria-hidden="true" />
							应用筛选
						</Button>
					</FilterBar>
					{state.error && (
						<Banner
							variant="alert"
							description={state.error}
							action={<Banner.Action onClick={() => void model.load()}>重试</Banner.Action>}
						/>
					)}
					<CollapsibleContent unstyled forceMount hidden={!open}>
						<Grid columns={1} gap="sm" role="group" aria-label="更多记忆筛选">
							<p id={valuesHint} className="octo-muted">
								多个值用英文逗号分隔。
							</p>
							<Grid
								className="octo-memory-filter-fields"
								columns={1}
								style={{
									gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
									alignItems: "start",
								}}
							>
								{[
									["tags_all", "包含全部标签"],
									["tags_any", "包含任一标签"],
									["sources", "来源密钥 ID"],
								].map(([name, label]) => (
									<Field key={name} label={label} htmlFor={`filter-${name}`}>
										<Input
											id={`filter-${name}`}
											name={name}
											aria-describedby={valuesHint}
											defaultValue={params.get(name as string) ?? ""}
										/>
									</Field>
								))}
								<Choice
									label="时间字段"
									name="time_field"
									value={params.get("time_field") ?? "updated"}
									options={["created", "updated", "event"]}
									optionLabels={timeFieldLabels}
								/>
								{[
									["time_from", "起始时间（UTC）"],
									["time_to", "结束时间（UTC）"],
								].map(([name, label]) => (
									<Field
										key={name}
										label={label}
										htmlFor={`filter-${name}`}
										hint="ISO 8601 UTC 格式"
									>
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
						</Grid>
					</CollapsibleContent>
				</form>
			</Collapsible>
		</Grid>
	);
}
