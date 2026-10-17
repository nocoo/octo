export function responseChunks(body: string): string[] {
	return body.match(/[\s\S]{1,60000}/gu) ?? [""];
}
