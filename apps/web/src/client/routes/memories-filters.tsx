import { Button, Field, Input } from "@nocoo/basalt";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { useState } from "react";
import { filterKeys } from "../viewmodels/memories";
import "../components/layout/markdown.css";

export function Choice({
	label,
	name,
	value,
	options,
	onChange,
}: {
	label: string;
	name?: string;
	value: string;
	options: readonly string[];
	onChange?: (value: string) => void;
}) {
	return (
		<Field label={label} {...(name ? { htmlFor: name } : {})}>
			<Select
				{...(name ? { name } : {})}
				{...(onChange ? { value, onValueChange: onChange } : { defaultValue: value })}
			>
				<SelectTrigger id={name} aria-label={label}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem value={option} key={option}>
							{option}
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
		<Collapsible open={open} onOpenChange={setOpen} className="octo-memory-stack">
			<CollapsibleTrigger asChild>
				<Button variant="outline" aria-label="Toggle memory filters">
					Filters{filterKeys.some((key) => params.has(key)) ? " (active)" : ""}
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent unstyled>
				<form
					key={params.toString()}
					className="octo-memory-stack"
					aria-label="Memory filters"
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
					<div className="octo-memory-fields">
						{[
							["spaces", "Spaces"],
							["tags_all", "All tags"],
							["tags_any", "Any tags"],
							["types", "Types"],
							["sources", "Source key IDs"],
						].map(([name, label]) => (
							<Field key={name} label={label} htmlFor={`filter-${name}`} hint="Comma-separated">
								<Input
									id={`filter-${name}`}
									name={name}
									defaultValue={params.get(name as string) ?? ""}
								/>
							</Field>
						))}
						<Choice
							label="Time field"
							name="time_field"
							value={params.get("time_field") ?? "updated"}
							options={["created", "updated", "event"]}
						/>
						{[
							["time_from", "From time (UTC)"],
							["time_to", "To time (UTC)"],
						].map(([name, label]) => (
							<Field key={name} label={label} htmlFor={`filter-${name}`} hint="ISO 8601 UTC">
								<Input
									id={`filter-${name}`}
									name={name}
									placeholder="2026-01-01T00:00:00Z"
									defaultValue={params.get(name as string) ?? ""}
								/>
							</Field>
						))}
						{[
							["importance_min", "Minimum importance"],
							["importance_max", "Maximum importance"],
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
					</div>
					<div className="octo-actions">
						<Button type="submit">Apply filters</Button>
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
							Clear filters
						</Button>
					</div>
				</form>
			</CollapsibleContent>
		</Collapsible>
	);
}
