import {
	Badge,
	Button,
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
	toast,
} from "@nocoo/basalt";
import { Sparkline } from "@nocoo/basalt/charts/sparkline";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
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
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/layout/page-header";
import { useModel } from "../components/layout/use-model";
import { RecordTime } from "../components/record-display";
import { formatNumber } from "../lib/format";
import { KeyUsageModel } from "../viewmodels/operations-key-usage";
import { type KeyMetadata, KeysModel, keyStatus } from "../viewmodels/operations-keys";
import { KeyForm, operationText, roleLabels, scopeLabels } from "./key-form";
import "./operations.css";

const statusLabels = { active: "有效", expired: "已过期", revoked: "已撤销" };

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
	const editorTrigger = useRef<HTMLButtonElement | null>(null);
	const rotateTrigger = useRef<HTMLButtonElement | null>(null);
	const deleteTrigger = useRef<HTMLButtonElement | null>(null);
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
	function openEditor(value: KeyMetadata | "create") {
		model.clearFormErrors();
		setEditor(value);
		void model.loadSpaces();
	}
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
			width: "16ch",
			wrap: true,
			sortValue: (key) => key.name,
			accessor: (key) => (
				<span className="block" style={{ width: "16ch" }}>
					<strong className="octo-record-title" title={key.name}>
						{key.name}
					</strong>
					<span className="octo-record-id" title={key.id}>
						{key.id}
					</span>
				</span>
			),
		},
		{
			id: "status",
			header: "状态",
			width: "10ch",
			sortValue: (key) => statusLabels[keyStatus(key)],
			accessor: (key) => (
				<Badge
					variant={
						keyStatus(key) === "active"
							? "success"
							: keyStatus(key) === "expired"
								? "warning"
								: "error"
					}
				>
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
			id: "role",
			header: "角色 / 范围",
			width: "18ch",
			wrap: true,
			sortValue: (key) => roleLabels[key.role],
			accessor: (key) => (
				<span>
					<TagBadge name={roleLabels[key.role]} size="sm" />{" "}
					<TagBadge name={scopeLabels[key.scope]} size="sm" />
					<br />
					<span className="text-basalt-sm text-basalt-muted-foreground">
						{operationText(key.ops)}
					</span>
				</span>
			),
		},
		{
			id: "last",
			header: "最近使用",
			width: "12ch",
			sortValue: (key) =>
				key.last_used_at === null ? Number.POSITIVE_INFINITY : Date.parse(key.last_used_at),
			accessor: (key) =>
				key.last_used_at === null ? (
					<span className="octo-muted">从未</span>
				) : (
					<RecordTime value={key.last_used_at} />
				),
		},
		{
			id: "usage",
			header: "30 天调用 · UTC",
			width: "16ch",
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
						summary={`${formatNumber(usage.total)} 次调用`}
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
			id: "expiry",
			header: "到期时间",
			width: "12ch",
			sortValue: (key) =>
				key.expires_at === null ? Number.POSITIVE_INFINITY : Date.parse(key.expires_at),
			accessor: (key) =>
				key.expires_at === null ? "永不过期" : <RecordTime value={key.expires_at} />,
		},
		{
			id: "actions",
			header: "操作",
			width: "1%",
			sortable: false,
			textAlign: "end",
			accessor: (key) =>
				key.revoked_at !== null ? (
					<Button
						icon={<Trash2 aria-hidden="true" />}
						size="sm"
						variant="destructive"
						disabled={state.pending}
						onClick={(event) => {
							deleteTrigger.current = event.currentTarget;
							model.openDelete(key.id);
						}}
						aria-label={`永久删除 ${key.name}`}
					>
						删除
					</Button>
				) : (
					<Grid columns={3} gap="sm" className="ops-key-actions">
						<Button
							icon={<Pencil aria-hidden="true" />}
							size="sm"
							variant="outline"
							disabled={state.pending}
							onClick={(event) => {
								editorTrigger.current = event.currentTarget;
								openEditor(key);
							}}
							aria-label={`编辑 ${key.name}`}
						>
							编辑
						</Button>
						<Button
							icon={<RotateCw aria-hidden="true" />}
							size="sm"
							variant="outline"
							disabled={state.pending || keyStatus(key) !== "active"}
							onClick={(event) => {
								rotateTrigger.current = event.currentTarget;
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
							disabled={state.pending}
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
		<Grid columns={1} gap="lg" className="min-w-0">
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
							onClick={(event) => {
								editorTrigger.current = event.currentTarget;
								openEditor("create");
							}}
							disabled={state.pending}
						>
							创建密钥
						</Button>
					</>
				}
			/>
			{state.error && editor === null && state.deleting === null && (
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
			<SectionRule variant="heading" title="密钥列表">
				<p className="text-basalt-sm text-basalt-muted-foreground">
					用量统计最近 30 个 UTC 日期（含今日）；今日数据尚未结束。
				</p>
				<LayerCard padding="none">
					{state.loading && state.items.length === 0 ? (
						<LayerCard.Loading label="正在加载接口密钥" />
					) : (
						<DataTable
							aria-label="接口密钥"
							className="octo-table"
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
										className="octo-empty octo-empty--page"
										icon={<KeyRound aria-hidden="true" />}
										title="暂无接口密钥。"
										description="为代理创建第一把密钥。"
										action={
											<Button
												icon={<Plus aria-hidden="true" />}
												disabled={state.pending}
												onClick={(event) => {
													editorTrigger.current = event.currentTarget;
													openEditor("create");
												}}
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
				<DialogContent
					size="lg"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						editorTrigger.current?.focus();
					}}
				>
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
							fieldErrors={state.fieldErrors}
							spaces={state.spaces}
							spacesLoading={state.spacesLoading}
							spacesLoaded={state.spacesLoaded}
							spacesError={state.spacesError}
							onLoadSpaces={() => void model.loadSpaces()}
							onClearErrors={() => model.clearFormErrors()}
							onClearFieldError={(field) => model.clearFieldError(field)}
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
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						rotateTrigger.current?.focus();
					}}
				>
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
				open={state.deleting !== null}
				onOpenChange={(open) => {
					if (!open) model.cancelDelete();
				}}
				onCloseAutoFocus={(event) => {
					if (!deleteTrigger.current?.isConnected) {
						event.preventDefault();
						createTrigger.current?.focus();
					}
				}}
				title={`永久删除 ${state.deleting?.name ?? "密钥"}？`}
				description={
					<>
						此操作无法恢复，密钥将从列表中永久移除。已有审计记录将保留，空间和记忆不受影响。
						{state.error && (
							<span
								className="mt-basalt-space-sm block font-medium text-basalt-danger"
								role="alert"
							>
								{state.error}
							</span>
						)}
					</>
				}
				variant="destructive"
				cancelLabel="取消"
				confirmLabel="永久删除"
				loading={state.pending}
				onConfirm={async () => {
					await model.deleteRevoked();
				}}
			/>
			<ConfirmDialog
				open={revoking !== null}
				onOpenChange={(open) => {
					if (!open) setRevoking(null);
				}}
				title={`撤销 ${revoking?.name ?? "密钥"}？`}
				description={
					<>
						{"此密钥的所有凭据将立即失效，且无法撤销此操作。"}
						{state.error && (
							<span
								className="mt-basalt-space-sm block font-medium text-basalt-danger"
								role="alert"
							>
								{state.error}
							</span>
						)}
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
