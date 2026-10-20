import { Button, DialogFooter, Field, Input } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { Grid } from "@nocoo/basalt/components/grid";
import { Save } from "lucide-react";

export function SpaceRenameForm({
	name,
	slug,
	pending,
	fieldErrors,
	error,
	onNameChange,
	onSlugChange,
	onCancel,
	onSubmit,
}: {
	name: string;
	slug: string;
	pending: boolean;
	fieldErrors: Partial<Record<"name" | "slug", string>>;
	error: string | null;
	onNameChange: (name: string) => void;
	onSlugChange: (slug: string) => void;
	onCancel: () => void;
	onSubmit: () => Promise<void>;
}) {
	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void onSubmit();
			}}
		>
			<Grid columns={1}>
				<Field
					label="空间名称"
					htmlFor="space-rename-name"
					required
					error={fieldErrors.name ?? null}
					hint="名称最多 256 个字符。"
				>
					<Input
						id="space-rename-name"
						name="name"
						value={name}
						required
						disabled={pending}
						autoComplete="off"
						onChange={(event) => onNameChange(event.target.value)}
					/>
				</Field>
				<Field
					label="空间标识"
					htmlFor="space-rename-slug"
					required
					error={fieldErrors.slug ?? null}
					hint="1 至 64 位小写字母、数字与单连字符；旧标识仍可使用 30 天。"
				>
					<Input
						id="space-rename-slug"
						name="slug"
						value={slug}
						required
						disabled={pending}
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						onChange={(event) => onSlugChange(event.target.value)}
					/>
				</Field>
				{error && !fieldErrors.name && !fieldErrors.slug && (
					<Banner role="alert" variant="error" size="sm" title="保存失败" description={error} />
				)}
			</Grid>
			<DialogFooter>
				<Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
					取消
				</Button>
				<Button type="submit" loading={pending} disabled={pending}>
					<Save size={16} aria-hidden="true" />
					{pending ? "正在保存" : "保存更改"}
				</Button>
			</DialogFooter>
		</form>
	);
}
