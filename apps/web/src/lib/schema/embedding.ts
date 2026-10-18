export type EmbeddingFailureReason = {
	stage: "config" | "decrypt" | "request" | "status" | "redirect" | "timeout" | "parse" | "dims";
	upstream_status?: number;
};
