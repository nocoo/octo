interface __BaseEnv_CloudflareBindings {
	DB: D1Database;
	FILES: R2Bucket;
	ASSETS: Fetcher;
}
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./apps/web/src/server/index");
	}
	interface Env extends __BaseEnv_CloudflareBindings {}
}
interface CloudflareBindings extends __BaseEnv_CloudflareBindings {}
