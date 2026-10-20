import {
	Badge,
	Button,
	ConfirmDialog,
	DescriptionList,
	Field,
	Input,
	LayerCard,
	Switch,
	toast,
} from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { Grid } from "@nocoo/basalt/components/grid";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { TagBadge } from "@nocoo/basalt/components/tag-badge";
import {
	CircleAlert,
	CircleCheck,
	PlugZap,
	RefreshCw,
	Save,
	Settings2,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useModel } from "../components/layout/use-model";
import { RecordTime } from "../components/record-display";
import { formatNumber } from "../lib/format";
import {
	type EmbeddingFields,
	EmbeddingModel,
	type EmbeddingProfile,
	embeddingFailureStageLabel,
	SettingsModel,
} from "../viewmodels/operations-embedding";
import { operationsError } from "../viewmodels/operations-errors";
import "./operations.css";

export function EmbeddingPage() {
	const [model] = useState(() => new EmbeddingModel());
	const state = useModel(model);
	const [fields, setFields] = useState<EmbeddingFields>(state.config);
	const [clearing, setClearing] = useState(false);
	const [testAttempt, setTestAttempt] = useState(0);
	const testFeedbackRequested = useRef(false);
	const secret = useRef<HTMLInputElement>(null);
	useEffect(() => {
		void model.load();
		return () => {
			if (secret.current) secret.current.value = "";
			model.dispose();
		};
	}, [model]);
	useEffect(() => {
		const { base_url, model: name, dims, backfill_enabled } = state.config;
		setFields({ base_url, model: name, dims, backfill_enabled });
	}, [state.config]);
	useEffect(() => {
		if (
			testAttempt === 0 ||
			!testFeedbackRequested.current ||
			state.pending ||
			(!state.error && !state.testResult)
		)
			return;
		document.getElementById("embedding-test-feedback")?.scrollIntoView({ block: "nearest" });
		testFeedbackRequested.current = false;
	}, [testAttempt, state.error, state.pending, state.testResult]);
	function takeSecret(): string | undefined {
		const value = secret.current?.value || undefined;
		if (secret.current) secret.current.value = "";
		return value;
	}
	return (
		<Grid columns={1} gap="md" className="min-w-0">
			<PageHeader
				title="向量模型"
				actions={
					<Button
						icon={<RefreshCw aria-hidden="true" />}
						variant="outline"
						onClick={() => void model.load()}
						disabled={state.loading || state.pending}
					>
						刷新
					</Button>
				}
			/>
			{state.loading && !state.loaded && <p role="status">正在加载网关设置……</p>}
			{state.error && !state.loaded && (
				<p role="alert">
					<CircleAlert className="inline size-basalt-icon" aria-hidden="true" /> {state.error}
				</p>
			)}
			<SectionRule title="网关配置">
				<LayerCard>
					<LayerCard.Body>
						{state.loaded ? (
							<form
								onSubmit={async (event) => {
									event.preventDefault();
									if (await model.save(fields, takeSecret())) toast.success("嵌入设置已保存。");
								}}
							>
								<Grid columns={1} gap="sm">
									<Field
										label="网关地址"
										required
										hint="兼容 OpenAI 的服务地址；服务端会追加 /v1/embeddings。"
									>
										<Input
											type="url"
											value={fields.base_url}
											onChange={(event) => setFields({ ...fields, base_url: event.target.value })}
											disabled={state.pending}
											required
											autoComplete="off"
										/>
									</Field>
									<Grid
										columns={2}
										gap="sm"
										style={{
											gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 13rem), 1fr))",
										}}
									>
										<Field label="模型" required>
											<Input
												value={fields.model}
												onChange={(event) => setFields({ ...fields, model: event.target.value })}
												disabled={state.pending}
												required
											/>
										</Field>
										<Field label="维度" required hint="更改维度需要匹配的 Vectorize 配置。">
											<Input
												type="number"
												min={1}
												max={1536}
												step={1}
												value={fields.dims}
												onChange={(event) =>
													setFields({ ...fields, dims: Number(event.target.value) })
												}
												disabled={state.pending}
												required
											/>
										</Field>
									</Grid>
									<Grid
										columns={2}
										gap="sm"
										className="ops-embedding-key-actions"
										style={{
											display: "flex",
											flexWrap: "wrap",
											alignItems: "center",
										}}
									>
										<p role="status">
											{state.config.api_key_set ? (
												<>已配置 {state.config.api_key_mask ?? ""}</>
											) : (
												"尚未配置接口密钥"
											)}
										</p>
										<Button
											className="justify-self-start"
											icon={<Trash2 aria-hidden="true" />}
											type="button"
											variant="outline"
											onClick={() => setClearing(true)}
											disabled={!state.config.api_key_set || state.pending}
										>
											清除已保存密钥
										</Button>
									</Grid>
									<Field
										label="替换密钥"
										hint="仅写入；留空保留原密钥。每次请求后清空，测试后保存前请重新输入。"
									>
										<Input
											ref={secret}
											type="password"
											autoComplete="new-password"
											passwordManagerIgnore
											disabled={state.pending}
										/>
									</Field>
									<Field
										label="回填缺失向量"
										htmlFor="embedding-backfill"
										hint="默认关闭；启用后，嵌入失败不会阻止记忆写入。"
									>
										<Switch
											id="embedding-backfill"
											checked={fields.backfill_enabled}
											onCheckedChange={(backfill_enabled) =>
												setFields({ ...fields, backfill_enabled })
											}
											disabled={state.pending}
										/>
									</Field>
									<Grid
										columns={2}
										gap="sm"
										className="ops-embedding-test-actions"
										style={{
											display: "flex",
											flexWrap: "wrap",
											alignItems: "center",
										}}
									>
										<Button
											icon={<PlugZap aria-hidden="true" />}
											type="button"
											variant="outline"
											loading={state.pending}
											onClick={() => {
												testFeedbackRequested.current = true;
												setTestAttempt((attempt) => attempt + 1);
												void model.test(fields, takeSecret());
											}}
										>
											测试连接
										</Button>
										<Button
											type="submit"
											icon={<Save aria-hidden="true" />}
											loading={state.pending}
										>
											保存设置
										</Button>
									</Grid>
									{state.error && state.loaded && !clearing && (
										<Banner
											variant="error"
											role="alert"
											icon={<CircleAlert aria-hidden="true" />}
											description={state.error}
											id="embedding-test-feedback"
										/>
									)}
									{state.testResult && !state.error && !clearing && (
										<Grid columns={1} gap="sm">
											<Banner
												variant={
													state.testResult.match && !state.testResult.error_code
														? "default"
														: "error"
												}
												role={
													state.testResult.match && !state.testResult.error_code
														? "status"
														: "alert"
												}
												icon={
													state.testResult.match && !state.testResult.error_code ? (
														<CircleCheck aria-hidden="true" />
													) : (
														<CircleAlert aria-hidden="true" />
													)
												}
												id="embedding-test-feedback"
												title={
													state.testResult.error_code
														? "连接失败"
														: state.testResult.match
															? "连接成功"
															: "维度不匹配"
												}
												description={
													state.testResult.error_code ? (
														<>
															错误：{operationsError(state.testResult.error_code)}{" "}
															<code>{state.testResult.error_code}</code>
														</>
													) : state.testResult.match ? (
														"向量维度与当前配置匹配。"
													) : (
														"上游返回的向量维度与当前配置不匹配。"
													)
												}
											/>
											<DescriptionList>
												<DescriptionList.Item term="延迟">
													{formatNumber(state.testResult.latency_ms)} ms
												</DescriptionList.Item>
												<DescriptionList.Item term="实际维度">
													{state.testResult.dims ?? "暂无数据"}
												</DescriptionList.Item>
												<DescriptionList.Item term="配置匹配">
													{state.testResult.match ? "是" : "否"}
												</DescriptionList.Item>
												{state.testResult.reason && (
													<DescriptionList.Item term="失败阶段">
														{embeddingFailureStageLabel(state.testResult.reason.stage)}
													</DescriptionList.Item>
												)}
												{state.testResult.reason?.upstream_status !== undefined && (
													<DescriptionList.Item term="上游状态码">
														{state.testResult.reason.upstream_status}
													</DescriptionList.Item>
												)}
											</DescriptionList>
										</Grid>
									)}
								</Grid>
							</form>
						) : (
							<p role="status">网关配置尚未加载，请刷新后再修改。</p>
						)}
					</LayerCard.Body>
				</LayerCard>
			</SectionRule>
			<ConfirmDialog
				open={clearing}
				onOpenChange={setClearing}
				title="清除已保存的接口密钥？"
				description={
					<>
						保存替换密钥前，查询嵌入将不可用。{" "}
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				variant="destructive"
				cancelLabel="取消"
				confirmLabel="清除密钥"
				loading={state.pending}
				onConfirm={async () => {
					takeSecret();
					if (await model.clearKey()) {
						setClearing(false);
						toast.success("已清除保存的接口密钥。");
					}
				}}
			/>
		</Grid>
	);
}

export function SettingsPage() {
	const [model] = useState(() => new SettingsModel());
	const state = useModel(model);
	useEffect(() => {
		void model.load();
		return () => model.dispose();
	}, [model]);
	const columns: DataTableColumn<EmbeddingProfile>[] = [
		{
			id: "id",
			header: "配置",
			width: "22ch",
			sortValue: (profile) => profile.id,
			accessor: (profile) => (
				<span className="octo-record-id" title={profile.id}>
					{profile.id}
				</span>
			),
		},
		{
			id: "model",
			header: "模型",
			width: "24ch",
			sortValue: (profile) => profile.model,
			accessor: (profile) => <TagBadge name={profile.model} size="sm" />,
		},
		{
			id: "dims",
			header: "维度",
			width: "10ch",
			textAlign: "end",
			sortValue: (profile) => profile.dims,
			accessor: (profile) => formatNumber(profile.dims),
		},
		{
			id: "metric",
			header: "距离度量",
			width: "16ch",
			accessor: (profile) =>
				({ cosine: "余弦相似度", euclidean: "欧氏距离", "dot-product": "点积" })[profile.metric] ??
				"未知度量",
		},
		{
			id: "created_at",
			header: "创建时间",
			width: "14ch",
			sortValue: (profile) => Date.parse(profile.created_at),
			accessor: (profile) => <RecordTime value={profile.created_at} />,
		},
		{
			id: "active",
			header: "状态",
			width: "12ch",
			sortValue: (profile) => (profile.active ? "已启用" : "未启用"),
			accessor: (profile) => (
				<Badge variant={profile.active ? "success" : "secondary"}>
					{profile.active ? "已启用" : "未启用"}
				</Badge>
			),
		},
	];
	return (
		<Grid columns={1} gap="md" className="min-w-0">
			<PageHeader
				title="设置"
				actions={
					<>
						<Button
							icon={<RefreshCw aria-hidden="true" />}
							variant="outline"
							onClick={() => void model.load()}
							disabled={state.loading}
						>
							刷新
						</Button>
						<Button asChild>
							<Link to="/settings/embedding">
								<Settings2 aria-hidden="true" />
								配置嵌入网关
							</Link>
						</Button>
					</>
				}
			/>
			<LayerCard>
				<LayerCard.Header>应用信息</LayerCard.Header>
				<LayerCard.Body>
					<DescriptionList>
						<DescriptionList.Item term="应用">Octo</DescriptionList.Item>
						<DescriptionList.Item term="活跃嵌入配置">
							{state.loaded ? (state.activeProfile ?? "尚无活跃配置") : "尚未加载"}
						</DescriptionList.Item>
					</DescriptionList>
				</LayerCard.Body>
			</LayerCard>
			{state.error && (
				<p role="alert">
					<CircleAlert className="inline size-basalt-icon" aria-hidden="true" /> {state.error}{" "}
					<Button
						icon={<RefreshCw aria-hidden="true" />}
						variant="ghost"
						size="sm"
						onClick={() => void model.load()}
					>
						重试
					</Button>
				</p>
			)}
			<SectionRule title="嵌入配置">
				<LayerCard padding="none">
					{state.loading && state.profiles.length === 0 ? (
						<LayerCard.Loading label="正在加载嵌入配置" />
					) : (
						<DataTable
							className="octo-table"
							aria-label="嵌入配置"
							columns={columns}
							data={state.profiles}
							getRowId={(profile) => profile.id}
							edge="attached"
							error={state.profiles.length === 0 ? state.error : null}
							retryLabel="重试"
							onRetry={() => void model.load()}
							empty={
								state.loaded ? (
									<LayerCard.Empty
										className="octo-empty octo-empty--page"
										icon={<Settings2 aria-hidden="true" />}
										title="尚未配置嵌入配置。"
										description="先设置网关与模型。"
										action={
											<Button asChild>
												<Link to="/settings/embedding">
													<Settings2 aria-hidden="true" />
													配置嵌入网关
												</Link>
											</Button>
										}
									/>
								) : (
									"嵌入配置尚未加载，请刷新。"
								)
							}
						/>
					)}
				</LayerCard>
			</SectionRule>
		</Grid>
	);
}
