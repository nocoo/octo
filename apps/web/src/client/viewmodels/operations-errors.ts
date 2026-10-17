import { ApiError } from "../lib/api";

const messages = new Map([
	["access_denied", "无权访问，请检查 Access 登录状态。"],
	["unauthenticated", "登录状态已失效，请重新登录。"],
	["forbidden", "没有执行此操作的权限。"],
	["not_found", "请求的资源不存在或不可访问。"],
	["validation_failed", "提交的数据不符合要求。"],
	["vector_dimension_mismatch", "向量维度不匹配。"],
	["embedder_unavailable", "嵌入服务暂时不可用。"],
	["version_conflict", "内容已发生变化，请刷新后重试。"],
	["tag_conflict", "标签发生冲突，请刷新后重试。"],
	["idempotency_conflict", "重复请求的内容不一致。"],
	["payload_too_large", "提交的内容过大。"],
	["unsupported_media_type", "不支持此文件类型。"],
	["unprocessable", "无法处理提交的内容。"],
	["internal", "服务内部发生错误，请稍后重试。"],
	["unavailable", "服务暂时不可用，请稍后重试。"],
]);

export function operationsError(error: unknown, fallback = "操作失败，请稍后重试。"): string {
	const code = error instanceof ApiError ? error.code : typeof error === "string" ? error : "";
	return messages.get(code) ?? fallback;
}
