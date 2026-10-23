import { Link } from "@nocoo/basalt";
import { TagBadge, type TagColor } from "@nocoo/basalt/components/tag-badge";
import { ToggleGroup, ToggleGroupItem } from "@nocoo/basalt/components/toggle-group";
import { formatDateTime } from "../lib/format";
import { memoryTypeLabels } from "../viewmodels/memories";

export function SpaceLink({ space, name = space }: { space: string; name?: string }) {
	return (
		<Link
			href={`/memories?${new URLSearchParams({ spaces: space })}`}
			className="octo-record-title"
			title={name}
		>
			{name}
		</Link>
	);
}

export function RecordTime({ value, utc = false }: { value: string; utc?: boolean }) {
	const formatted = formatDateTime(value, utc ? "UTC" : undefined);
	const [date, time] = formatted.split(" ");
	return (
		<time
			dateTime={value}
			title={`${formatted}${utc ? " UTC" : " (本地时间)"}`}
			className="octo-record-time"
		>
			<span>{date}</span>
			<span className="octo-muted">
				{time}
				{utc ? " UTC" : ""}
			</span>
		</time>
	);
}

const typeColors: Record<string, TagColor> = {
	fact: "blue",
	preference: "rose",
	decision: "amber",
	procedure: "teal",
	event: "violet",
	log: "slate",
	note: "info",
};

export function MemoryTypeBadge({ type }: { type: string }) {
	return (
		<TagBadge
			name={memoryTypeLabels[type] ?? "未知类型"}
			color={typeColors[type] ?? "slate"}
			size="sm"
		/>
	);
}

export function ViewSwitch({
	id,
	label,
	value,
	options,
	onChange,
}: {
	id?: string;
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
}) {
	return (
		<ToggleGroup
			type="single"
			aria-label={label}
			value={value}
			onValueChange={(next) => {
				if (next) onChange(next);
			}}
		>
			{options.map((option) => (
				<ToggleGroupItem
					key={option.value}
					value={option.value}
					id={option.value === value ? id : undefined}
				>
					{option.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
