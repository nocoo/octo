import { type Button, type DialogContent, type Input, ThemeProvider } from "@nocoo/basalt";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryModel } from "../viewmodels/library";
import { SpacesPage } from "./library";

const snapshot = vi.hoisted(() => ({
	close: null as ComponentProps<typeof DialogContent>["onCloseAutoFocus"] | null,
	open: null as ComponentProps<typeof Button>["onClick"] | null,
	filter: { isConnected: true, focus: vi.fn() },
}));
vi.mock("../components/layout/use-model", () => ({
	useModel: () => ({
		...new LibraryModel("spaces").state,
		ready: true,
		spaces: [
			{
				id: "space",
				slug: "space",
				name: "原始空间",
				description: "",
				owner_key_id: null,
				memory_count: 0,
			},
		],
	}),
}));
vi.mock("@nocoo/basalt", async (importOriginal) => {
	const original = await importOriginal<typeof import("@nocoo/basalt")>();
	return {
		...original,
		Dialog: ({ children }: { children: ReactNode }) => children,
		DialogContent: (props: ComponentProps<typeof DialogContent>) => {
			if (props.size === "sm") snapshot.close = props.onCloseAutoFocus;
			return null;
		},
		Input: (props: ComponentProps<typeof Input>) => {
			if (props["aria-label"] === "筛选空间" && props.ref && typeof props.ref !== "function")
				props.ref.current = snapshot.filter as unknown as HTMLInputElement;
			return <original.Input {...props} />;
		},
		Button: (props: ComponentProps<typeof Button>) => {
			if (props["aria-label"] === "重命名空间 原始空间") snapshot.open = props.onClick;
			return <original.Button {...props} />;
		},
	};
});

afterEach(() => {
	snapshot.close = null;
	snapshot.open = null;
	vi.clearAllMocks();
});

it.each([true, false])("restores rename focus with opener connected=%s", (isConnected) => {
	renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={["/spaces?q=原始空间"]}>
				<SpacesPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	const opener = { isConnected, focus: vi.fn() };
	expect(snapshot.open).toBeTypeOf("function");
	snapshot.open?.({ currentTarget: opener } as never);
	const event = { preventDefault: vi.fn() };
	expect(snapshot.close).toBeTypeOf("function");
	snapshot.close?.(event as never);
	expect(event.preventDefault).toHaveBeenCalledOnce();
	expect(opener.focus).toHaveBeenCalledTimes(isConnected ? 1 : 0);
	expect(snapshot.filter.focus).toHaveBeenCalledTimes(isConnected ? 0 : 1);
});
