export type EmbedderConfig = {
	baseUrl: string;
	apiKey: string;
	model: string;
	dims: number;
	timeoutMs?: number;
	userAgent: string;
};

export interface QueryEmbedder {
	embed(texts: string[]): Promise<number[][]>;
}
