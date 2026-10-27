import type { SQLInputValue } from "node:sqlite";

export function normalizeSqliteBinds(binds: SQLInputValue[]): SQLInputValue[] {
	return binds.map((param) => {
		if (param instanceof Uint8Array) return Buffer.from(param);
		if (param instanceof ArrayBuffer) return Buffer.from(param);
		if (ArrayBuffer.isView(param))
			return Buffer.from(param.buffer, param.byteOffset, param.byteLength);
		if (typeof param === "boolean") return param ? 1 : 0;
		if (typeof param === "bigint") return Number(param);
		return param;
	});
}
