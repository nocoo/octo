import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpaceRenameForm } from "./space-rename";

const props = {
	name: "原始空间",
	pending: false,
	fieldError: null,
	error: null,
	onChange: () => {},
	onCancel: () => {},
	onSubmit: async () => {},
};

describe("space rename Basalt form", () => {
	it("uses Chinese labels, native submission and installed Basalt fields", () => {
		const html = renderToStaticMarkup(<SpaceRenameForm {...props} />);
		expect(html).toContain("空间名称");
		expect(html).toContain("保存名称");
		expect(html).toContain("取消");
		expect(html).toContain('value="原始空间"');
		expect(html).toContain('name="name"');
		expect(html).toContain("noValidate");
		expect(html).toContain("gap-basalt-field-gap");
		expect(html).not.toMatch(
			/(?:style="[^"]*(?:padding|margin)|class="[^"\n]*\b[mp][xytrblse]?-[0-9])/,
		);
	});
	it("associates field errors with the name input instead of the form banner", () => {
		const html = renderToStaticMarkup(
			<SpaceRenameForm {...props} fieldError="请输入有效的空间名称。" error="请检查提交内容。" />,
		);
		expect(html).toContain('aria-invalid="true"');
		expect(html).toContain('aria-describedby="space-rename-name-error"');
		expect(html).toContain('id="space-rename-name-error"');
		expect(html).toContain("请输入有效的空间名称。");
		expect(html).not.toContain("请检查提交内容。");
	});
	it("keeps request failures in a Chinese dialog-local banner", () => {
		const html = renderToStaticMarkup(
			<SpaceRenameForm {...props} error="服务暂时不可用，请稍后重试。" />,
		);
		expect(html).toContain("保存失败");
		expect(html).toContain("服务暂时不可用，请稍后重试。");
		expect(html).not.toContain('aria-invalid="true"');
	});
	it("disables the name, cancellation and submission while pending", () => {
		const html = renderToStaticMarkup(<SpaceRenameForm {...props} pending />);
		expect(html.match(/disabled=""/g)).toHaveLength(3);
		expect(html).toContain("正在保存");
	});
});
