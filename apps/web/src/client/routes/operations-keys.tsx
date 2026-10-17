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
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { useEffect, useId, useRef, useState } from "react";
import { useModel } from "../components/layout/use-model";
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
const time = (value: number | null): string =>
	value === null ? "Never" : new Date(value).toLocaleString();
function localDate(value: number | null): string {
	if (value === null) return "";
	const date = new Date(value);
	return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
			className="ops-stack"
			onSubmit={async (event) => {
				event.preventDefault();
				await onSubmit({
					name,
					role,
					expires_at: expiry ? new Date(expiry).getTime() : null,
					permissions: {
						...permissions,
						space_ids: spaces
							.split(",")
							.map((space) => space.trim())
							.filter(Boolean),
					},
				});
			}}
		>
			<Field label="Agent name" required>
				<Input
					value={name}
					onChange={(event) => setName(event.target.value)}
					required
					disabled={pending || initial !== null}
					autoComplete="off"
				/>
			</Field>
			<div className="ops-fields">
				<Field label="Role template" htmlFor={`${id}-role`} required>
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
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{roles.map((value) => (
								<SelectItem key={value} value={value}>
									{value}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<Field label="Expires at" hint="Local time; leave empty for no expiry.">
					<Input
						type="datetime-local"
						value={expiry}
						onChange={(event) => setExpiry(event.target.value)}
						disabled={pending}
					/>
				</Field>
			</div>
			{role === "custom" ? (
				<>
					<fieldset className="ops-stack">
						<legend>Allowed operations</legend>
						<div className="ops-actions">
							{[
								["r", "Read"],
								["w", "Create"],
								["u", "Update"],
								["d", "Delete"],
							].map(([op, label]) => (
								<label className="ops-inline" key={op} htmlFor={`${id}-${op}`}>
									<Checkbox
										id={`${id}-${op}`}
										checked={permissions.ops.split(",").includes(op ?? "")}
										disabled={pending}
										onCheckedChange={(checked) => {
											const selected = new Set(permissions.ops.split(",").filter(Boolean));
											if (checked) selected.add(op ?? "");
											else selected.delete(op ?? "");
											setPermissions({
												...permissions,
												ops: ["r", "w", "u", "d"].filter((value) => selected.has(value)).join(","),
											});
										}}
									/>
									{label}
								</label>
							))}
						</div>
					</fieldset>
					<Field label="Space scope" htmlFor={`${id}-scope`} required>
						<Select
							value={permissions.scope}
							onValueChange={(scope) =>
								setPermissions({ ...permissions, scope: scope as KeyPermissions["scope"] })
							}
							disabled={pending}
						>
							<SelectTrigger id={`${id}-scope`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="spaces">Selected spaces</SelectItem>
								<SelectItem value="own">Owned spaces</SelectItem>
								<SelectItem value="all">All spaces</SelectItem>
							</SelectContent>
						</Select>
					</Field>
					{permissions.scope === "spaces" && (
						<Field label="Space IDs" hint="Comma-separated; at least one is required." required>
							<Input
								value={spaces}
								onChange={(event) => setSpaces(event.target.value)}
								required
								disabled={pending}
							/>
						</Field>
					)}
					<label className="ops-inline" htmlFor={`${id}-own`}>
						<Switch
							id={`${id}-own`}
							checked={permissions.own_entries_only}
							onCheckedChange={(own_entries_only) =>
								setPermissions({ ...permissions, own_entries_only })
							}
							disabled={pending}
						/>
						Only update or delete this agent's entries
					</label>
					<label className="ops-inline" htmlFor={`${id}-auto-space`}>
						<Switch
							id={`${id}-auto-space`}
							checked={permissions.auto_own_space}
							onCheckedChange={(auto_own_space) =>
								setPermissions({ ...permissions, auto_own_space })
							}
							disabled={pending}
						/>
						Automatically create an owned space
					</label>
				</>
			) : (
				<p className="ops-muted">
					Operations: {permissions.ops}. Scope: {permissions.scope}. API keys cannot manage keys or
					gateway settings.
				</p>
			)}
			{error && <p role="alert">{error}</p>}
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
					Cancel
				</Button>
				<Button type="submit" loading={pending}>
					{initial ? "Save permissions" : "Create key"}
				</Button>
			</DialogFooter>
		</form>
	);
}

export function KeysPage() {
	const [model] = useState(() => new KeysModel());
	const state = useModel(model);
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
	function reveal(value: string | null) {
		if (!active.current || !value) return;
		setEditor(null);
		setRotating(null);
		setCopied(false);
		secretRevision.current++;
		setSecret(value);
	}
	function clearSecret() {
		secretRevision.current++;
		setSecret(null);
		setCopied(false);
	}
	const columns: DataTableColumn<KeyMetadata>[] = [
		{
			id: "name",
			header: "Agent",
			accessor: (key) => (
				<span>
					<strong>{key.name}</strong>
					<br />
					<span className="ops-muted">{key.id}</span>
				</span>
			),
		},
		{
			id: "role",
			header: "Role / scope",
			accessor: (key) => (
				<span>
					{key.role}
					<br />
					<span className="ops-muted">
						{key.scope} / {key.ops}
					</span>
				</span>
			),
		},
		{
			id: "status",
			header: "Status",
			accessor: (key) => (
				<Badge variant={keyStatus(key) === "active" ? "success" : "secondary"}>
					{keyStatus(key)}
				</Badge>
			),
		},
		{ id: "expiry", header: "Expiry", accessor: (key) => time(key.expires_at) },
		{ id: "last", header: "Last used", accessor: (key) => time(key.last_used_at) },
		{
			id: "usage",
			header: "Recent calls",
			sortable: false,
			accessor: (key) =>
				key.usage.length ? (
					<div className="ops-spark">
						<Sparkline
							data={key.usage.map((calls, index) => ({ x: index + 1, y: calls }))}
							ariaLabel={`Recent calls for ${key.name}`}
							summary={
								<span className="sr-only">
									{key.usage.reduce((total, calls) => total + calls, 0)} calls across{" "}
									{key.usage.length} periods.
								</span>
							}
							dataAlternative={
								<details>
									<summary>Values</summary>
									<Table aria-label={`Recent calls data for ${key.name}`}>
										<TableHeader>
											<TableRow>
												<TableHead>Period</TableHead>
												<TableHead textAlign="end">Calls</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{key.usage
												.map((calls, index) => ({ calls, period: index + 1 }))
												.map(({ calls, period }) => (
													<TableRow key={period}>
														<TableCell>{period}</TableCell>
														<TableCell textAlign="end">{calls}</TableCell>
													</TableRow>
												))}
										</TableBody>
									</Table>
								</details>
							}
						/>
					</div>
				) : (
					"No calls"
				),
		},
		{
			id: "actions",
			header: "Actions",
			sortable: false,
			accessor: (key) => (
				<div className="ops-actions">
					<Button
						size="sm"
						variant="outline"
						disabled={state.pending || key.revoked_at !== null}
						onClick={() => setEditor(key)}
						aria-label={`Edit ${key.name}`}
					>
						Edit
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={state.pending || keyStatus(key) !== "active"}
						onClick={() => {
							setRotating(key);
							setGrace("0");
						}}
						aria-label={`Rotate ${key.name}`}
					>
						Rotate
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={state.pending || key.revoked_at !== null}
						onClick={() => setRevoking(key)}
						aria-label={`Revoke ${key.name}`}
					>
						Revoke
					</Button>
				</div>
			),
		},
	];
	return (
		<div className="ops-page">
			<PageHeader
				title="API keys"
				description="Agent permissions, expiry and usage. Plaintext is revealed once, never persisted."
				actions={
					<>
						<Button variant="outline" onClick={() => void model.load()} disabled={state.loading}>
							Refresh
						</Button>
						<Button
							ref={createTrigger}
							onClick={() => setEditor("create")}
							disabled={state.pending}
						>
							Create key
						</Button>
					</>
				}
			/>
			{state.error && (
				<p role="alert">
					{state.error}{" "}
					<Button variant="ghost" size="sm" onClick={() => void model.load()}>
						Retry
					</Button>
				</p>
			)}
			<LayerCard>
				<DataTable
					aria-label="API keys"
					data={state.items}
					columns={columns}
					getRowId={(key) => key.id}
					edge="attached"
					loading={state.loading && state.items.length === 0}
					empty="No API keys. Create an agent key to get started."
				/>
			</LayerCard>
			<Dialog
				open={editor !== null}
				onOpenChange={(open) => {
					if (!open && !state.pending) setEditor(null);
				}}
			>
				<DialogContent size="lg">
					<DialogHeader>
						<DialogTitle>{editor === "create" ? "Create API key" : "Edit API key"}</DialogTitle>
						<DialogDescription>
							Permissions apply to data only. Key management remains Access-only.
						</DialogDescription>
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
						<DialogTitle>Rotate {rotating?.name}</DialogTitle>
						<DialogDescription>
							The previous secret remains valid only during the selected grace period. Zero
							invalidates it immediately.
						</DialogDescription>
					</DialogHeader>
					<form
						className="ops-stack"
						onSubmit={async (event) => {
							event.preventDefault();
							if (rotating) reveal(await model.rotate(rotating.id, Number(grace)));
						}}
					>
						<Field label="Grace period (seconds)" hint="0 to 604800 (7 days)." required>
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
								Cancel
							</Button>
							<Button type="submit" loading={state.pending}>
								Rotate key
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={revoking !== null}
				onOpenChange={(open) => {
					if (!open) setRevoking(null);
				}}
				title={`Revoke ${revoking?.name ?? "key"}?`}
				description={
					<>
						{"All secrets for this key stop working immediately. This cannot be undone."}
						{state.error && <span role="alert">{state.error}</span>}
					</>
				}
				variant="destructive"
				confirmLabel="Revoke key"
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
						<DialogTitle>Copy your key now</DialogTitle>
						<DialogDescription>
							This is the only time the plaintext is shown. Closing this dialog permanently clears
							it from this page.
						</DialogDescription>
					</DialogHeader>
					{secret !== null && (
						<Field label="API key">
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
						<Button variant="outline" onClick={clearSecret}>
							Close and clear
						</Button>
						<Button
							loading={copying}
							onClick={async () => {
								if (!secret || copying) return;
								const revision = secretRevision.current;
								setCopying(true);
								try {
									await navigator.clipboard.writeText(secret);
									if (active.current && revision === secretRevision.current) setCopied(true);
								} catch {
									toast.error("Unable to copy. Select the key and copy it manually.");
								} finally {
									if (active.current) setCopying(false);
								}
							}}
						>
							{copied ? "Copied" : "Copy key"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
