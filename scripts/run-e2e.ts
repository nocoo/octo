import { runIfMain } from "./cli";
import { runE2eApi } from "./e2e";

export async function main(): Promise<number> {
	return runE2eApi();
}

await runIfMain(import.meta, main);
