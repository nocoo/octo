import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpaceRenameForm } from "./space-rename";

const props = {
	name: "原始空间",
	slug: "original-space",
	pending: false,
	fieldErrors: {},
	error: null,
	onNameChange: () => {},
	onSlugChange: () => {},
	onCancel: () => {},
	onSubmit: async () => {},
};

describe("space rename Basalt form", () => {
	it("uses Chinese labels, native submission and installed Basalt fields", () => {
		const html = renderToStaticMarkup(<SpaceRenameForm {...props} />);
		expect(html).toContain("空间名称");
		expect(html).toContain("空间标识");
		expect(html).toContain("保存更改");
		expect(html).toContain("取消");
		expect(html).toContain('value="原始空间"');
		expect(html).toContain('name="name"');
		expect(html).toContain('name="slug"');
		expect(html).toContain('value="original-space"');
		expect(html).toContain("旧标识仍可使用 30 天");
		expect(html).not.toContain("空间标识保持不变");
		expect(html).toContain("noValidate");
		expect(html).toContain("gap-basalt-field-gap");
		expect(html).not.toMatch(
			/(?:style="[^"]*(?:padding|margin)|class="[^"\n]*\b[mp][xytrblse]?-[0-9])/,
		);
	});
	it("associates field errors with the name input instead of the form banner", () => {
		const html = renderToStaticMarkup(
			<SpaceRenameForm
				{...props}
				fieldErrors={{ name: "请输入有效的空间名称。" }}
				error="请检查提交内容。"
			/>,
		);
		expect(html).toContain('aria-invalid="true"');
		expect(html).toContain('aria-describedby="space-rename-name-error"');
		expect(html).toContain('id="space-rename-name-error"');
		expect(html).toContain("请输入有效的空间名称。");
		expect(html).not.toContain("请检查提交内容。");
	});
	it("associates slug errors only with the slug input and hides the summary banner", () => {
		const html = renderToStaticMarkup(
			<SpaceRenameForm
				{...props}
				fieldErrors={{ slug: "空间标识已被占用，请使用其他标识。" }}
				error="内容已被修改，请刷新后重试。"
			/>,
		);
		expect(html).toContain('aria-describedby="space-rename-slug-error"');
		expect(html).toContain('id="space-rename-slug-error"');
		expect(html).toContain("空间标识已被占用，请使用其他标识。");
		expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
		expect(html).not.toContain("内容已被修改，请刷新后重试。");
	});
	it("keeps request failures in a Chinese dialog-local banner", () => {
		const html = renderToStaticMarkup(
			<SpaceRenameForm {...props} error="服务暂时不可用，请稍后重试。" />,
		);
		expect(html).toContain("保存失败");
		expect(html).toContain("服务暂时不可用，请稍后重试。");
		expect(html).not.toContain('aria-invalid="true"');
	});
	it("disables both fields, cancellation and submission while pending", () => {
		const html = renderToStaticMarkup(<SpaceRenameForm {...props} pending />);
		expect(html.match(/disabled=""/g)).toHaveLength(4);
		expect(html).toContain("正在保存");
	});
});
