export const CORE_TABLES = [
	"spaces",
	"memories",
	"memory_versions",
	"tags",
	"memory_tags",
	"attachments",
	"embedding_profiles",
	"memory_vectors",
	"settings",
	"changes",
	"idempotency_records",
	"api_keys",
	"audit_log",
	"usage_daily",
	"memories_fts",
	"memories_fts_map",
] as const;

export const CORE_MIGRATION = "migrations/0001_core.sql";
