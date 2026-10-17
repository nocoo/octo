export function defaultExit(code: number): void {
	process.exit(code);
}

export async function runIfMain(
	meta: { main: boolean },
	run: () => Promise<number>,
	exit: (code: number) => void = defaultExit,
): Promise<void> {
	if (!meta.main) {
		return;
	}
	exit(await run());
}
