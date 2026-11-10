export const MIN_NODE_MAJOR = 26;

export function assertNodeRuntime(): number {
	const major = Number(process.versions.node.split(".")[0] ?? "0");
	if (major < MIN_NODE_MAJOR) {
		console.error(
			`L1 requires Node ${MIN_NODE_MAJOR}+ (Vitest/D1/sqlite contract); got ${process.versions.node}.`,
		);
		return 1;
	}
	return 0;
}
