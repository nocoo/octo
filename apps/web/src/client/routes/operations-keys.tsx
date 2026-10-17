import {
	Badge,
	Button,
	Checkbox,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
	LayerCard,
	Switch,
	toast,
} from "@nocoo/basalt";
import { Sparkline } from "@nocoo/basalt/charts/sparkline";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import {
	Ban,
	Check,
	CircleAlert,
	Clock,
	Copy,
	KeyRound,
	Pencil,
	Plus,
	RefreshCw,
	RotateCw,
	Save,
	X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useModel } from "../components/layout/use-model";
import { KeyUsageModel } from "../viewmodels/operations-key-usage";
import {
	type KeyDraft,
	type KeyMetadata,
	type KeyPermissions,
	type KeyRole,
	KeysModel,
	keyStatus,
	rolePermissions,
} from "../viewmodels/operations-keys";
import "./operations.css";

const roles: KeyRole[] = ["project", "drop", "readonly", "admin", "custom"];
const roleLabels = {
	project: "项目",
	drop: "仅投递",
	readonly: "只读",
	admin: "管理员",
	custom: "自定义",
};
const scopeLabels = { all: "全部空间", spaces: "指定空间", own: "自有空间" };
const statusLabels = { active: "有效", expired: "已过期", revoked: "已撤销" };
const operationLabels: Record<string, string> = { r: "读取", w: "创建", u: "更新", d: "删除" };
const operationText = (ops: string) =>
	ops
		.split(",")
		.map((op) => operationLabels[op] ?? "未授权")
		.join("、");
const time = (value: string | null): string =>
	value === null ? "从未" : new Date(value).toLocaleString("zh-CN");
function localDate(value: string | null): string {
	if (value === null) return "";
	const date = new Date(value);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function KeyForm({
	initial,
	pending,
	error,
	onSubmit,
	onCancel,
}: {
	initial: KeyMetadata | null;
	pending: boolean;
	error: string | null;
	onSubmit: (draft: KeyDraft) => Promise<void>;
	onCancel: () => void;
}) {
	const id = useId();
	const [name, setName] = useState(initial?.name ?? "");
	const [role, setRole] = useState<KeyRole>(initial?.role ?? "project");
	const [expiry, setExpiry] = useState(localDate(initial?.expires_at ?? null));
	const [permissions, setPermissions] = useState<KeyPermissions>(() =>
		initial
			? {
					ops: initial.ops,
					scope: initial.scope,
					space_ids: initial.space_ids,
					own_entries_only: initial.own_entries_only,
					auto_own_space: initial.auto_own_space,
				}
			: rolePermissions("project"),
	);
	const [spaces, setSpaces] = useState(initial?.space_ids.join(", ") ?? "");
	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				await onSubmit({
					name,
					role,
					expires_at: expiry ? new Date(expiry).toISOString() : null,
					permissions: {
						...permissions,
						space_ids:
							permissions.scope === "spaces"
								? spaces
										.split(",")
										.map((space) => space.trim())
										.filter(Boolean)
								: [],
					},
				});
			}}
		>
			<Grid columns={1} gap="sm">
				<Field
					label="代理名称"
					required
					hint="项目或自动创建空间的名称须为 1 至 64 位小写字母、数字与单连字符。"
				>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
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
					<Field label="角色模板" htmlFor={`${id}-role`} required>
						<Select
							value={role}
							disabled={pending}
							onValueChange={(value) => {
								const next = value as KeyRole;
								setRole(next);
								setPermissions(rolePermissions(next));
							}}
						>
							<SelectTrigger id={`${id}-role`}>
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
					<Field label="到期时间" hint="本地时间；留空表示永不过期。">
						<Input
							type="datetime-local"
							value={expiry}
							onChange={(event) => setExpiry(event.target.value)}
							disabled={pending}
						/>
					</Field>
				</Grid>
				{role === "custom" ? (
					<>
						<Checkbox.Group
							value={permissions.ops.split(",").filter(Boolean)}
							disabled={pending}
							onValueChange={(values) =>
								setPermissions({
									...permissions,
									ops: ["r", "w", "u", "d"].filter((op) => values.includes(op)).join(","),
								})
							}
						>
							<Checkbox.Legend>允许的操作</Checkbox.Legend>
							<Grid columns={4} gap="sm" style={{ alignItems: "center" }}>
								{[
									["r", "读取"],
									["w", "创建"],
									["u", "更新"],
									["d", "删除"],
								].map(([op, label]) => (
									<Checkbox.Item key={op} value={op ?? ""}>
										{label}
									</Checkbox.Item>
								))}
							</Grid>
						</Checkbox.Group>
						<Field label="空间范围" htmlFor={`${id}-scope`} required>
							<Select
								value={permissions.scope}
								onValueChange={(scope) =>
									setPermissions({ ...permissions, scope: scope as KeyPermissions["scope"] })
								}
								disabled={pending}
							>
								<SelectTrigger id={`${id}-scope`}>
									<SelectValue>{scopeLabels[permissions.scope]}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="spaces">指定空间</SelectItem>
									<SelectItem value="own">自有空间</SelectItem>
									<SelectItem value="all">全部空间</SelectItem>
								</SelectContent>
							</Select>
						</Field>
						{permissions.scope === "spaces" && (
							<Field label="空间标识" hint="以逗号分隔；至少指定一个空间。" required>
								<Input
									value={spaces}
									onChange={(event) => setSpaces(event.target.value)}
									required
									disabled={pending}
								/>
							</Field>
						)}
						<Field label="仅更新或删除此代理的记忆" htmlFor={`${id}-own`}>
							<Switch
								id={`${id}-own`}
								checked={permissions.own_entries_only}
								onCheckedChange={(own_entries_only) =>
									setPermissions({ ...permissions, own_entries_only })
								}
								disabled={pending}
							/>
						</Field>
						<Field label="自动创建自有空间" htmlFor={`${id}-auto-space`}>
							<Switch
								id={`${id}-auto-space`}
								checked={permissions.auto_own_space}
								onCheckedChange={(auto_own_space) =>
									setPermissions({ ...permissions, auto_own_space })
								}
								disabled={pending}
							/>
						</Field>
					</>
				) : (
					<p className="text-basalt-sm text-basalt-muted-foreground">
						操作：{operationText(permissions.ops)}；范围：{scopeLabels[permissions.scope]}
						。接口密钥不能管理密钥或网关设置。
					</p>
				)}
				{role === "drop" && (
					<Field label="空间标识" hint="以逗号分隔；至少指定一个空间。" required>
						<Input
							value={spaces}
							onChange={(event) => setSpaces(event.target.value)}
							required
							disabled={pending}
						/>
					</Field>
				)}
				{error && <p role="alert">{error}</p>}
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

export function KeysPage() {
	const [model] = useState(() => new KeysModel());
	const state = useModel(model);
	const [usageModel] = useState(() => new KeyUsageModel());
	const usageState = useModel(usageModel);
	const [editor, setEditor] = useState<KeyMetadata | "create" | null>(null);
	const [rotating, setRotating] = useState<KeyMetadata | null>(null);
	const [revoking, setRevoking] = useState<KeyMetadata | null>(null);
	const [grace, setGrace] = useState("0");
	const [secret, setSecret] = useState<string | null>(null);
	const [copying, setCopying] = useState(false);
	const [copied, setCopied] = useState(false);
	const secretRevision = useRef(0);
	const active = useRef(true);
	const createTrigger = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		active.current = true;
		void model.load();
		return () => {
			active.current = false;
			model.dispose();
		};
	}, [model]);
	useEffect(() => {
		void usageModel.load();
		return () => usageModel.dispose();
	}, [usageModel]);
	function reveal(value: string | null) {
		if (!active.current || !value) return;
		setEditor(null);
		setRotating(null);
		setCopied(false);
		secretRevision.current++;
		setSecret(value);
		void usageModel.load();
	}
	function clearSecret() {
		secretRevision.current++;
		setSecret(null);
		setCopied(false);
	}
	const columns: DataTableColumn<KeyMetadata>[] = [
		{
			id: "name",
			header: "代理",
			sortValue: (key) => key.name,
			accessor: (key) => (
				<span>
					<strong>{key.name}</strong>
					<br />
					<span className="text-basalt-sm text-basalt-muted-foreground">{key.id}</span>
				</span>
			),
		},
		{
			id: "role",
			header: "角色 / 范围",
			sortValue: (key) => roleLabels[key.role],
			accessor: (key) => (
				<span>
					{roleLabels[key.role]}
					<br />
					<span className="text-basalt-sm text-basalt-muted-foreground">
						{scopeLabels[key.scope]} / {operationText(key.ops)}
					</span>
				</span>
			),
		},
		{
			id: "status",
			header: "状态",
			sortValue: (key) => statusLabels[keyStatus(key)],
			accessor: (key) => (
				<Badge variant={keyStatus(key) === "active" ? "success" : "secondary"}>
					{keyStatus(key) === "active" ? (
						<Check className="size-basalt-icon" aria-hidden="true" />
					) : keyStatus(key) === "expired" ? (
						<Clock className="size-basalt-icon" aria-hidden="true" />
					) : (
						<Ban className="size-basalt-icon" aria-hidden="true" />
					)}
					{statusLabels[keyStatus(key)]}
				</Badge>
			),
		},
		{
			id: "expiry",
			header: "到期时间",
			sortValue: (key) =>
				key.expires_at === null ? Number.POSITIVE_INFINITY : Date.parse(key.expires_at),
			accessor: (key) => (key.expires_at === null ? "永不过期" : time(key.expires_at)),
		},
		{
			id: "last",
			header: "最近使用",
			sortValue: (key) =>
				key.last_used_at === null ? Number.POSITIVE_INFINITY : Date.parse(key.last_used_at),
			accessor: (key) => time(key.last_used_at),
		},
		{
			id: "usage",
			header: "近 30 天调用（UTC）",
			sortable: false,
			accessor: (key) => {
				const usage = usageModel.usage(key.id);
				if (!usage)
					return usageState.loading
						? "正在加载用量"
						: usageState.error
							? "用量不可用"
							: "用量尚未加载";
				return (
					<Sparkline
						data={usage.data}
						series={[{ key: "calls", label: "调用次数" }]}
						ariaLabel={`${key.name} 近 30 天每日调用量`}
						summary={`${usage.total} 次调用`}
						dataAlternative={
							<span className="sr-only">
								{usageState.snapshot?.from} 至 {usageState.snapshot?.to}（UTC）：
								{usage.data.map((point) => `${point.x}：${point.calls} 次`).join("；")}
							</span>
						}
					/>
				);
			},
		},
		{
			id: "actions",
			header: "操作",
			sortable: false,
			accessor: (key) => (
				<Grid
					columns={3}
					gap="sm"
					style={{
						gridTemplateColumns: "repeat(3, max-content)",
						alignItems: "center",
					}}
				>
					<Button
						icon={<Pencil aria-hidden="true" />}
						size="sm"
						variant="outline"
						disabled={state.pending || key.revoked_at !== null}
						onClick={() => setEditor(key)}
						aria-label={`编辑 ${key.name}`}
					>
						编辑
					</Button>
					<Button
						icon={<RotateCw aria-hidden="true" />}
						size="sm"
						variant="outline"
						disabled={state.pending || keyStatus(key) !== "active"}
						onClick={() => {
							setRotating(key);
							setGrace("0");
						}}
						aria-label={`轮换 ${key.name}`}
					>
						轮换
					</Button>
					<Button
						icon={<Ban aria-hidden="true" />}
						size="sm"
						variant="ghost"
						disabled={state.pending || key.revoked_at !== null}
						onClick={() => setRevoking(key)}
						aria-label={`撤销 ${key.name}`}
					>
						撤销
					</Button>
				</Grid>
			),
		},
	];
	return (
		<Grid columns={1} gap="md" className="min-w-0">
			<PageHeader
				title="接口密钥"
				description="明文仅展示一次，绝不持久化。"
				actions={
					<>
						<Button
							icon={<RefreshCw aria-hidden="true" />}
							variant="outline"
							onClick={() => {
								void model.load();
								void usageModel.load();
							}}
							disabled={state.loading}
						>
							刷新
						</Button>
						<Button
							icon={<Plus aria-hidden="true" />}
							ref={createTrigger}
							onClick={() => setEditor("create")}
							disabled={state.pending}
						>
							创建密钥
						</Button>
					</>
				}
			/>
			{state.error && (
				<p role="alert">
					<CircleAlert className="inline size-basalt-icon" aria-hidden="true" /> {state.error}{" "}
					<Button variant="ghost" size="sm" onClick={() => void model.load()}>
						重试
					</Button>
				</p>
			)}
			{usageState.error && (
				<p role="alert">
					{usageState.error} {usageState.snapshot && "用量刷新失败；当前图表为上次成功数据。"}
					<Button variant="ghost" size="sm" onClick={() => void usageModel.load()}>
						重试用量
					</Button>
				</p>
			)}
			{usageState.loading && usageState.snapshot && (
				<p role="status">用量刷新中；当前图表为上次成功数据。</p>
			)}
			<SectionRule title="密钥列表">
				<p className="text-basalt-sm text-basalt-muted-foreground">
					用量统计最近 30 个 UTC 日期（含今日）；今日数据尚未结束。
				</p>
				<LayerCard padding="none">
					{state.loading && state.items.length === 0 ? (
						<LayerCard.Loading label="正在加载接口密钥" />
					) : (
						<DataTable
							aria-label="接口密钥"
							data={state.items}
							columns={columns}
							getRowId={(key) => key.id}
							edge="attached"
							error={state.items.length === 0 ? state.error : null}
							retryLabel="重试"
							onRetry={() => void model.load()}
							empty={
								state.loaded ? (
									<LayerCard.Empty
										icon={<KeyRound aria-hidden="true" />}
										title="暂无接口密钥。"
										description="为代理创建第一把密钥。"
										action={
											<Button
												icon={<Plus aria-hidden="true" />}
												disabled={state.pending}
												onClick={() => setEditor("create")}
											>
												创建密钥
											</Button>
										}
									/>
								) : (
									"接口密钥列表尚未加载，请刷新。"
								)
							}
						/>
					)}
				</LayerCard>
			</SectionRule>
			<Dialog
				open={editor !== null}
				onOpenChange={(open) => {
					if (!open && !state.pending) setEditor(null);
				}}
			>
				<DialogContent size="lg">
					<DialogHeader>
						<DialogTitle>{editor === "create" ? "创建接口密钥" : "编辑接口密钥"}</DialogTitle>
						<DialogDescription>权限仅适用于数据；密钥管理仍仅限 Access 访问。</DialogDescription>
					</DialogHeader>
					{editor !== null && (
						<KeyForm
							key={editor === "create" ? "create" : editor.id}
							initial={editor === "create" ? null : editor}
							pending={state.pending}
							error={state.error}
							onCancel={() => setEditor(null)}
							onSubmit={async (draft) => {
								if (editor === "create") reveal(await model.create(draft));
								else if (editor && (await model.update(editor.id, draft))) setEditor(null);
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={rotating !== null}
				onOpenChange={(open) => {
					if (!open && !state.pending) setRotating(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>轮换 {rotating?.name}</DialogTitle>
						<DialogDescription>
							旧密钥仅在所选宽限期内有效；设为零会立即使其失效。
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={async (event) => {
							event.preventDefault();
							if (rotating) reveal(await model.rotate(rotating.id, Number(grace)));
						}}
					>
						<Grid columns={1} gap="sm">
							<Field label="宽限期（秒）" hint="0 至 604800 秒（7 天）。" required>
								<Input
									type="number"
									min={0}
									max={604800}
									step={1}
									value={grace}
									onChange={(event) => setGrace(event.target.value)}
									required
									disabled={state.pending}
								/>
							</Field>
							{state.error && <p role="alert">{state.error}</p>}
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setRotating(null)}
									disabled={state.pending}
								>
									取消
								</Button>
								<Button
									type="submit"
									icon={<RotateCw aria-hidden="true" />}
									loading={state.pending}
								>
									轮换密钥
								</Button>
							</DialogFooter>
						</Grid>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={revoking !== null}
				onOpenChange={(open) => {
					if (!open) setRevoking(null);
				}}
				title={`撤销 ${revoking?.name ?? "密钥"}？`}
				description={
					<>
						{"此密钥的所有凭据将立即失效，且无法撤销此操作。"}
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				variant="destructive"
				cancelLabel="取消"
				confirmLabel="撤销密钥"
				loading={state.pending}
				onConfirm={async () => {
					if (revoking && (await model.revoke(revoking.id))) setRevoking(null);
				}}
			/>
			<Dialog
				open={secret !== null}
				onOpenChange={(open) => {
					if (!open) {
						clearSecret();
					}
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						createTrigger.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>请立即复制密钥</DialogTitle>
						<DialogDescription>
							明文仅展示这一次；关闭对话框会将其从此页面彻底清除。
						</DialogDescription>
					</DialogHeader>
					{secret !== null && (
						<Field label="接口密钥">
							<Input
								readOnly
								value={secret}
								autoComplete="off"
								passwordManagerIgnore
								spellCheck={false}
							/>
						</Field>
					)}
					<DialogFooter>
						<Button icon={<X aria-hidden="true" />} variant="outline" onClick={clearSecret}>
							关闭并清除
						</Button>
						<Button
							icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
							loading={copying}
							onClick={async () => {
								if (!secret || copying) return;
								const revision = secretRevision.current;
								setCopying(true);
								try {
									await navigator.clipboard.writeText(secret);
									if (active.current && revision === secretRevision.current) setCopied(true);
								} catch {
									toast.error("无法复制，请选中密钥后手动复制。");
								} finally {
									if (active.current) setCopying(false);
								}
							}}
						>
							{copied ? "已复制" : "复制密钥"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Grid>
	);
}
