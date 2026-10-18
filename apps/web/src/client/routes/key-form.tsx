import { Button, Checkbox, DialogFooter, Field, Input, Switch } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { Grid } from "@nocoo/basalt/components/grid";
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { CircleAlert, RefreshCw, Save } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
	isKeySpaceSlug,
	type KeyDraft,
	type KeyField,
	type KeyFieldErrors,
	type KeyMetadata,
	type KeyPermissions,
	type KeyRole,
	type KeySpace,
	rolePermissions,
} from "../viewmodels/operations-keys";

export const roleLabels = {
	project: "项目",
	drop: "仅投递",
	readonly: "只读",
	admin: "管理员",
	custom: "自定义",
};
export const scopeLabels = { all: "全部空间", spaces: "指定空间", own: "自有空间" };
export const operationLabels: Record<string, string> = {
	r: "读取",
	w: "创建",
	u: "更新",
	d: "删除",
};
export const operationText = (ops: string) =>
	ops
		.split(",")
		.map((op) => operationLabels[op] ?? "未授权")
		.join("、");
const roles: KeyRole[] = ["project", "drop", "readonly", "admin", "custom"];
const slugHint = "名称须为 1 至 64 位小写字母、数字与单连字符；当前名称不符合规则，无法启用。";

function localDate(value: string | null): string {
	if (value === null) return "";
	const date = new Date(value);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export interface KeyFormProps {
	initial: KeyMetadata | null;
	pending: boolean;
	error: string | null;
	fieldErrors: KeyFieldErrors;
	spaces: KeySpace[];
	spacesLoading: boolean;
	spacesLoaded: boolean;
	spacesError: string | null;
	onLoadSpaces: () => void;
	onClearErrors: () => void;
	onClearFieldError: (field: KeyField) => void;
	onSubmit: (draft: KeyDraft) => Promise<void>;
	onCancel: () => void;
}

export function KeyForm({
	initial,
	pending,
	error,
	fieldErrors,
	spaces,
	spacesLoading,
	spacesLoaded,
	spacesError,
	onLoadSpaces,
	onClearErrors,
	onClearFieldError,
	onSubmit,
	onCancel,
}: KeyFormProps) {
	const id = useId();
	const [name, setName] = useState(initial?.name ?? "");
	const [role, setRole] = useState<KeyRole>(initial?.role ?? "project");
	const [expiry, setExpiry] = useState(localDate(initial?.expires_at ?? null));
	const expiryInput = useRef<HTMLInputElement>(null);
	const [permissions, setPermissions] = useState<KeyPermissions>(() =>
		initial
			? {
					ops: initial.ops,
					scope: initial.scope,
					space_ids: initial.space_ids,
					own_entries_only: initial.own_entries_only,
					auto_own_space: initial.role === "project" || initial.auto_own_space,
				}
			: rolePermissions("project"),
	);
	const validName = isKeySpaceSlug(name);
	const autoSpace = role === "project" || (permissions.auto_own_space && validName);
	return (
		<form
			noValidate
			onSubmit={async (event) => {
				event.preventDefault();
				const expiryDate = expiry ? new Date(expiry) : null;
				await onSubmit({
					name,
					role,
					expires_at: expiryInput.current?.validity.badInput
						? ""
						: expiryDate
							? Number.isFinite(expiryDate.getTime())
								? expiryDate.toISOString()
								: expiry
							: null,
					permissions: {
						...permissions,
						space_ids: permissions.scope === "spaces" ? permissions.space_ids : [],
						auto_own_space: autoSpace,
					},
				});
			}}
		>
			<Grid columns={1} gap="sm">
				{error && (
					<Banner
						variant="error"
						size="sm"
						role="alert"
						icon={<CircleAlert aria-hidden="true" />}
						description={error}
					/>
				)}
				<Field
					label="代理名称"
					required
					error={fieldErrors.name ?? null}
					hint={
						initial
							? "名称创建后不可修改。"
							: "项目或自动创建空间的名称须为 1 至 64 位小写字母、数字与单连字符。"
					}
				>
					<Input
						value={name}
						onChange={(event) => {
							const next = event.target.value;
							setName(next);
							if (role === "custom" && !isKeySpaceSlug(next))
								setPermissions({ ...permissions, auto_own_space: false });
							onClearFieldError("name");
							onClearFieldError("auto_own_space");
						}}
						required
						disabled={pending || initial !== null}
						autoComplete="off"
					/>
				</Field>
				<Grid
					columns={2}
					gap="sm"
					style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 13rem), 1fr))" }}
				>
					<Field label="角色模板" htmlFor={`${id}-role`} required error={fieldErrors.role ?? null}>
						<Select
							value={role}
							disabled={pending}
							onValueChange={(value) => {
								const next = value as KeyRole;
								setRole(next);
								setPermissions(rolePermissions(next));
								onClearErrors();
							}}
						>
							<SelectTrigger
								id={`${id}-role`}
								aria-invalid={Boolean(fieldErrors.role)}
								aria-describedby={fieldErrors.role ? `${id}-role-error` : undefined}
							>
								<SelectValue>{roleLabels[role]}</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{roles.map((value) => (
									<SelectItem key={value} value={value}>
										{roleLabels[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field
						label="到期时间"
						hint="本地时间；留空表示永不过期。"
						error={fieldErrors.expires_at ?? null}
					>
						<Input
							ref={expiryInput}
							type="datetime-local"
							value={expiry}
							onChange={(event) => {
								setExpiry(event.target.value);
								onClearFieldError("expires_at");
							}}
							disabled={pending}
						/>
					</Field>
				</Grid>
				{role === "custom" ? (
					<>
						<Checkbox.Group
							value={permissions.ops.split(",").filter(Boolean)}
							disabled={pending}
							error={fieldErrors.ops ?? null}
							onValueChange={(values) => {
								setPermissions({
									...permissions,
									ops: ["r", "w", "u", "d"].filter((op) => values.includes(op)).join(","),
								});
								onClearFieldError("ops");
							}}
						>
							<Checkbox.Legend>允许的操作</Checkbox.Legend>
							<Grid
								columns={4}
								gap="sm"
								className="ops-key-permissions"
								style={{
									gridTemplateColumns:
										"repeat(auto-fit, minmax(min(100%, var(--basalt-space-36)), 1fr))",
									alignItems: "center",
								}}
							>
								{Object.entries(operationLabels).map(([op, label]) => (
									<Checkbox.Item key={op} value={op}>
										{label}
									</Checkbox.Item>
								))}
							</Grid>
						</Checkbox.Group>
						<Field
							label="空间范围"
							htmlFor={`${id}-scope`}
							required
							error={fieldErrors.scope ?? null}
						>
							<Select
								value={permissions.scope}
								onValueChange={(scope) => {
									setPermissions({ ...permissions, scope: scope as KeyPermissions["scope"] });
									onClearFieldError("scope");
									onClearFieldError("space_ids");
								}}
								disabled={pending}
							>
								<SelectTrigger
									id={`${id}-scope`}
									aria-invalid={Boolean(fieldErrors.scope)}
									aria-describedby={fieldErrors.scope ? `${id}-scope-error` : undefined}
								>
									<SelectValue>{scopeLabels[permissions.scope]}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="spaces">指定空间</SelectItem>
									<SelectItem value="own">自有空间</SelectItem>
									<SelectItem value="all">全部空间</SelectItem>
								</SelectContent>
							</Select>
						</Field>
					</>
				) : (
					<p className="text-basalt-sm text-basalt-muted-foreground">
						操作：{operationText(permissions.ops)}；范围：{scopeLabels[permissions.scope]}
						。接口密钥不能管理密钥或网关设置。
					</p>
				)}
				{permissions.scope === "spaces" && (
					<>
						<Field
							label="空间"
							required
							error={fieldErrors.space_ids ?? null}
							hint="可多选现有空间。"
						>
							<Grid columns={1} gap="sm" role="group" aria-label="空间">
								<MultiSelect
									label="空间"
									options={spaces.map((space) => ({
										value: space.id,
										label: `${space.name}（${space.slug}）`,
									}))}
									value={permissions.space_ids}
									onValueChange={(space_ids) => {
										setPermissions({ ...permissions, space_ids });
										onClearFieldError("space_ids");
									}}
									disabled={pending || spacesLoading || !spacesLoaded || spacesError !== null}
									loading={spacesLoading}
									placeholder="选择授权空间"
									searchPlaceholder="搜索空间名称或标识"
									emptyLabel="没有匹配的空间"
									loadingLabel="正在加载空间"
									removeLabel="移除"
									formatSelectionCount={(count) => `已选择 ${count} 个空间`}
								/>
							</Grid>
						</Field>
						{fieldErrors.space_ids && (
							<Button
								type="button"
								variant="outline"
								icon={<RefreshCw aria-hidden="true" />}
								onClick={onLoadSpaces}
								disabled={pending || spacesLoading}
							>
								刷新空间
							</Button>
						)}
						{spacesLoading && <p role="status">正在加载空间…</p>}
						{spacesError && (
							<Banner
								variant="error"
								size="sm"
								role="alert"
								description={spacesError}
								action={
									<Banner.Action onClick={onLoadSpaces} disabled={pending || spacesLoading}>
										重试加载空间
									</Banner.Action>
								}
							/>
						)}
						{spacesLoaded && !spacesLoading && !spacesError && spaces.length === 0 && (
							<p role="status">暂无可授权的空间，请先在空间页面创建。</p>
						)}
					</>
				)}
				{role === "custom" && (
					<Field
						label="仅更新或删除此代理的记忆"
						htmlFor={`${id}-own`}
						error={fieldErrors.own_entries_only ?? null}
					>
						<Switch
							id={`${id}-own`}
							checked={permissions.own_entries_only}
							onCheckedChange={(own_entries_only) => {
								setPermissions({ ...permissions, own_entries_only });
								onClearFieldError("own_entries_only");
							}}
							disabled={pending}
						/>
					</Field>
				)}
				{(role === "project" || role === "custom") && (
					<Field
						label="自动创建自有空间"
						htmlFor={`${id}-auto-space`}
						error={fieldErrors.auto_own_space ?? null}
						hint={
							validName
								? role === "project"
									? "项目模板固定开启，使用代理名称作为空间标识。"
									: "使用代理名称作为空间标识；仅自定义角色可修改此项。"
								: `${slugHint}${role === "project" ? "项目模板固定开启，须使用符合规则的名称。" : ""}`
						}
					>
						<Switch
							id={`${id}-auto-space`}
							checked={autoSpace}
							onCheckedChange={(auto_own_space) => {
								setPermissions({ ...permissions, auto_own_space });
								onClearFieldError("auto_own_space");
							}}
							disabled={pending || role === "project" || !validName}
						/>
					</Field>
				)}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
						取消
					</Button>
					<Button type="submit" icon={<Save aria-hidden="true" />} loading={pending}>
						{initial ? "保存权限" : "创建密钥"}
					</Button>
				</DialogFooter>
			</Grid>
		</form>
	);
}
