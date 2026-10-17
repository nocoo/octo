import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import LibraryGraphCanvas from "./library-graph";

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

it("hosts the specialist canvas in a real Basalt surface with Chinese guidance and an icon action", () => {
	const html = renderToStaticMarkup(
		<MemoryRouter>
			<LibraryGraphCanvas graph={{ nodes: [], links: [], clustered: 0 }} />
		</MemoryRouter>,
	);
	expect(html).toContain('data-basalt-surface=""');
	expect(html).toContain("h-basalt-80 w-full overflow-hidden");
	expect(html).toContain("力导向关系图");
	expect(html).toContain("适应画布");
	expect(html).toContain("lucide-maximize-2");
	expect(html).toContain("蓝色：标签；绿色：记忆；灰色：聚合节点。");
	expect(html).not.toContain('class="library-');
});

it("shows the selected node's complete name outside the canvas", () => {
	const label = "A long memory title ".repeat(5);
	const html = renderToStaticMarkup(
		<MemoryRouter initialEntries={["/graph?node=memory-1"]}>
			<LibraryGraphCanvas
				graph={{
					nodes: [{ id: "memory-1", label, kind: "memory", count: 1, href: "/memories/memory-1" }],
					links: [],
					clustered: 0,
				}}
			/>
		</MemoryRouter>,
	);
	expect(html).toContain(label);
	expect(html).toContain("悬停或选择节点查看名称");
	expect(html).toContain("break-words");
});
