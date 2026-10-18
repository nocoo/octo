import type { EmbeddingFailureReason } from "../../../lib/schema/embedding";
import { ApiError } from "../../lib/errors";

export class EmbeddingFailure extends ApiError {
	constructor(
		readonly reason: EmbeddingFailureReason,
		message = `embedding ${reason.stage} failed`,
	) {
		super(reason.stage === "dims" ? "vector_dimension_mismatch" : "unavailable", message);
	}
}

export function reportEmbeddingFailure(
	event: "embedding_test_failed" | "embedding_backfill_failed" | "embedding_query_failed",
	error: unknown,
	baseUrl: string | null,
	fallback: EmbeddingFailureReason["stage"] = "config",
): EmbeddingFailureReason {
	const reason = error instanceof EmbeddingFailure ? error.reason : { stage: fallback };
	let host: string | null = null;
	try {
		host = baseUrl === null ? null : new URL(baseUrl).host;
	} catch {
		host = null;
	}
	console.error({ event, ...reason, host });
	return reason;
}
