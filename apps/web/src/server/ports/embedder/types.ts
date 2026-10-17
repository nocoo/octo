export type EmbedderConfig = {
	baseUrl: string;
	apiKey: string;
	model: string;
	dims: number;
	timeoutMs?: number;
};

export interface QueryEmbedder {
	embed(texts: string[]): Promise<number[][]>;
}
