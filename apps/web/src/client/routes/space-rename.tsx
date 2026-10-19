import { Button, DialogFooter, Field, Input } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { Grid } from "@nocoo/basalt/components/grid";
import { Save } from "lucide-react";

export function SpaceRenameForm({
	name,
	pending,
	fieldError,
	error,
	onChange,
	onCancel,
	onSubmit,
}: {
	name: string;
	pending: boolean;
	fieldError: string | null;
	error: string | null;
	onChange: (name: string) => void;
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
					error={fieldError}
					hint="名称最多 256 个字符，空间标识保持不变。"
				>
					<Input
						id="space-rename-name"
						name="name"
						value={name}
						required
						disabled={pending}
						autoComplete="off"
						onChange={(event) => onChange(event.target.value)}
					/>
				</Field>
				{error && !fieldError && (
					<Banner role="alert" variant="error" size="sm" title="保存失败" description={error} />
				)}
			</Grid>
			<DialogFooter>
				<Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
					取消
				</Button>
				<Button type="submit" loading={pending} disabled={pending}>
					<Save size={16} aria-hidden="true" />
					{pending ? "正在保存" : "保存名称"}
				</Button>
			</DialogFooter>
		</form>
	);
}
