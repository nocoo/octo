import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryModel, type LibraryState } from "../viewmodels/library";
import { TrashPage } from "./library";

const snapshot = vi.hoisted(() => ({ state: null as LibraryState | null }));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: LibraryModel) => snapshot.state ?? model.state,
}));

function render() {
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={["/trash?selected=failed&q=missing"]}>
				<TrashPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
}

afterEach(() => {
	snapshot.state = null;
});
describe("trash pagination view", () => {
	it("offers server load-more even when the local filter has no matches, retaining selection and failures", () => {
		snapshot.state = {
			...new LibraryModel("trash").state,
			ready: true,
			nextCursor: "older",
			failures: [{ id: "failed", message: "内容已被修改，请刷新后重试。" }],
		};
		const html = render();
		expect(html).toContain("加载更多");
		expect(html).toContain("已加载的记忆中没有符合条件的内容");
		expect(html).toContain("恢复所选记忆（1）");
		expect(html).toContain("failed");
		expect(html).toContain("内容已被修改，请刷新后重试。");
		expect(html).not.toContain("仅代表这些样本");
	});
	it("hides server load-more at the end of the cursor sequence", () => {
		snapshot.state = { ...new LibraryModel("trash").state, ready: true };
		expect(render()).not.toContain("加载更多");
	});
});
