import { runIfMain } from "./cli";
import { parseShardFlag, runE2eApi } from "./e2e";

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const shard = parseShardFlag(argv);
	return runE2eApi(shard ? { shard } : {});
}

await runIfMain(import.meta, main);
