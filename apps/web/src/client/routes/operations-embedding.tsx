import {
	Badge,
	Button,
	ConfirmDialog,
	DescriptionList,
	Field,
	Input,
	LayerCard,
	StatStrip,
	Switch,
	toast,
} from "@nocoo/basalt";
import { DataTable, type DataTableColumn } from "@nocoo/basalt/components/data-table";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { APP_VERSION } from "../../lib/version";
import { useModel } from "../components/layout/use-model";
import {
	type EmbeddingFields,
	EmbeddingModel,
	type EmbeddingProfile,
	SettingsModel,
} from "../viewmodels/operations-embedding";
import "./operations.css";

export function EmbeddingPage() {
	const [model] = useState(() => new EmbeddingModel());
	const state = useModel(model);
	const [fields, setFields] = useState<EmbeddingFields>(state.config);
	const [clearing, setClearing] = useState(false);
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
	function takeSecret(): string | undefined {
		const value = secret.current?.value || undefined;
		if (secret.current) secret.current.value = "";
		return value;
	}
	return (
		<div className="ops-page">
			<PageHeader
				title="Embedding gateway"
				description="Access-only query embeddings. Model and dimensions must match the active profile."
				actions={
					<Button
						variant="outline"
						onClick={() => void model.load()}
						disabled={state.loading || state.pending}
					>
						Refresh
					</Button>
				}
			/>
			{state.loading && !state.loaded && <p role="status">Loading gateway settings...</p>}
			{state.error && <p role="alert">{state.error}</p>}
			<LayerCard>
				<LayerCard.Header>Gateway configuration</LayerCard.Header>
				<LayerCard.Body>
					{state.loaded ? (
						<form
							className="ops-stack"
							onSubmit={async (event) => {
								event.preventDefault();
								if (await model.save(fields, takeSecret()))
									toast.success("Embedding settings saved.");
							}}
						>
							<Field
								label="Gateway URL"
								required
								hint="OpenAI-compatible base URL; /v1/embeddings is added by the server."
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
							<div className="ops-fields">
								<Field label="Model" required>
									<Input
										value={fields.model}
										onChange={(event) => setFields({ ...fields, model: event.target.value })}
										disabled={state.pending}
										required
									/>
								</Field>
								<Field
									label="Dimensions"
									required
									hint="Changing dimensions requires a matching Vectorize profile."
								>
									<Input
										type="number"
										min={1}
										max={1536}
										step={1}
										value={fields.dims}
										onChange={(event) => setFields({ ...fields, dims: Number(event.target.value) })}
										disabled={state.pending}
										required
									/>
								</Field>
							</div>
							<div className="ops-row">
								<p role="status">
									{state.config.api_key_set ? (
										<>
											Configured {"\u2022\u2022\u2022\u2022"}
											{state.config.api_key_suffix ?? ""}
										</>
									) : (
										"No API key configured"
									)}
								</p>
								<Button
									type="button"
									variant="outline"
									onClick={() => setClearing(true)}
									disabled={!state.config.api_key_set || state.pending}
								>
									Clear saved key
								</Button>
							</div>
							<Field
								label="Replacement API key"
								hint="Write-only. Left empty keeps the saved key. Cleared after each request; re-enter before saving after a test."
							>
								<Input
									ref={secret}
									type="password"
									autoComplete="new-password"
									passwordManagerIgnore
									disabled={state.pending}
								/>
							</Field>
							<label className="ops-inline" htmlFor="embedding-backfill">
								<Switch
									id="embedding-backfill"
									checked={fields.backfill_enabled}
									onCheckedChange={(backfill_enabled) => setFields({ ...fields, backfill_enabled })}
									disabled={state.pending}
								/>
								Backfill missing vectors
							</label>
							<p className="ops-muted">
								Backfill is off by default. When enabled, embedding failures never block memory
								writes.
							</p>
							<div className="ops-actions">
								<Button
									type="button"
									variant="outline"
									loading={state.pending}
									onClick={() => void model.test(fields, takeSecret())}
								>
									Test connection
								</Button>
								<Button type="submit" loading={state.pending}>
									Save settings
								</Button>
							</div>
						</form>
					) : (
						<p role="status">
							Gateway configuration is unknown. Refresh settings before making changes.
						</p>
					)}
				</LayerCard.Body>
			</LayerCard>
			{state.testResult && (
				<LayerCard>
					<LayerCard.Header>
						Connection result{" "}
						<Badge
							variant={
								state.testResult.dims_match && !state.testResult.error_code
									? "success"
									: "secondary"
							}
						>
							{state.testResult.error_code
								? "Failed"
								: state.testResult.dims_match
									? "Connected"
									: "Dimension mismatch"}
						</Badge>
					</LayerCard.Header>
					<LayerCard.Body>
						<StatStrip
							items={[
								{ label: "Latency", value: `${state.testResult.latency_ms} ms` },
								{
									label: "Actual dimensions",
									value: state.testResult.actual_dims ?? "Unavailable",
								},
								{ label: "Profile match", value: state.testResult.dims_match ? "Yes" : "No" },
							]}
						/>
						{state.testResult.error_code && (
							<p role="alert">Error code: {state.testResult.error_code}</p>
						)}
					</LayerCard.Body>
				</LayerCard>
			)}
			<ConfirmDialog
				open={clearing}
				onOpenChange={setClearing}
				title="Clear the saved API key?"
				description={
					<>
						Query embeddings will be unavailable until a replacement is saved.{" "}
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				variant="destructive"
				confirmLabel="Clear key"
				loading={state.pending}
				onConfirm={async () => {
					takeSecret();
					if (await model.save(state.config, null)) {
						setClearing(false);
						toast.success("Saved API key cleared.");
					}
				}}
			/>
		</div>
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
		{ id: "id", header: "Profile", accessor: (profile) => profile.id },
		{ id: "model", header: "Model", accessor: (profile) => profile.model },
		{ id: "dims", header: "Dimensions", textAlign: "end", accessor: (profile) => profile.dims },
		{ id: "metric", header: "Metric", accessor: (profile) => profile.metric },
		{
			id: "active",
			header: "Status",
			sortValue: (profile) => (profile.active ? "Active" : "Inactive"),
			accessor: (profile) => (
				<Badge variant={profile.active ? "success" : "secondary"}>
					{profile.active ? "Active" : "Inactive"}
				</Badge>
			),
		},
	];
	return (
		<div className="ops-page">
			<PageHeader
				title="Settings"
				description="Application version and embedding profiles."
				actions={
					<>
						<Button variant="outline" onClick={() => void model.load()} disabled={state.loading}>
							Refresh
						</Button>
						<Button asChild>
							<Link to="/settings/embedding">Configure embedding gateway</Link>
						</Button>
					</>
				}
			/>
			<LayerCard>
				<LayerCard.Body>
					<DescriptionList>
						<DescriptionList.Item term="Application">Octo</DescriptionList.Item>
						<DescriptionList.Item term="Version">{APP_VERSION}</DescriptionList.Item>
					</DescriptionList>
				</LayerCard.Body>
			</LayerCard>
			{state.error && (
				<p role="alert">
					{state.error}{" "}
					<Button variant="ghost" size="sm" onClick={() => void model.load()}>
						Retry
					</Button>
				</p>
			)}
			<LayerCard>
				<LayerCard.Header>Embedding profiles</LayerCard.Header>
				<DataTable
					aria-label="Embedding profiles"
					columns={columns}
					data={state.profiles}
					getRowId={(profile) => profile.id}
					edge="attached"
					loading={state.loading && state.profiles.length === 0}
					error={state.profiles.length === 0 ? state.error : null}
					onRetry={() => void model.load()}
					empty={
						state.loaded
							? "No embedding profiles configured."
							: "Embedding profiles are unknown. Refresh to load profiles."
					}
				/>
			</LayerCard>
		</div>
	);
}
