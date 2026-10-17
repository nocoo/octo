import { LinkProvider, ThemeProvider, TooltipProvider } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import { lazy, type ReactNode } from "react";
import {
	createBrowserRouter,
	createRoutesFromElements,
	Link,
	Route,
	RouterProvider,
} from "react-router";
import { AppShell } from "./components/layout/app-shell";
import { notificationViewport } from "./components/layout/notifications";

const OverviewPage = lazy(() =>
	import("./routes/overview").then((page) => ({ default: page.OverviewPage })),
);

const MemoriesPage = lazy(() =>
	import("./routes/memories").then((page) => ({ default: page.MemoriesPage })),
);
const MemoryPage = lazy(() =>
	import("./routes/memories").then((page) => ({ default: page.MemoryPage })),
);
const EditorPage = lazy(() =>
	import("./routes/memories").then((page) => ({ default: page.EditorPage })),
);
const HistoryPage = lazy(() =>
	import("./routes/memories").then((page) => ({ default: page.HistoryPage })),
);
const SearchPage = lazy(() =>
	import("./routes/search").then((page) => ({ default: page.SearchPage })),
);
const TagsPage = lazy(() =>
	import("./routes/library").then((page) => ({ default: page.TagsPage })),
);
const SpacesPage = lazy(() =>
	import("./routes/library").then((page) => ({ default: page.SpacesPage })),
);
const TrashPage = lazy(() =>
	import("./routes/library").then((page) => ({ default: page.TrashPage })),
);
const GraphPage = lazy(() =>
	import("./routes/library").then((page) => ({ default: page.GraphPage })),
);
const TimelinePage = lazy(() =>
	import("./routes/library").then((page) => ({ default: page.TimelinePage })),
);
const KeysPage = lazy(() =>
	import("./routes/operations").then((page) => ({ default: page.KeysPage })),
);
const UsagePage = lazy(() =>
	import("./routes/operations").then((page) => ({ default: page.UsagePage })),
);
const AuditPage = lazy(() =>
	import("./routes/operations").then((page) => ({ default: page.AuditPage })),
);
const SettingsPage = lazy(() =>
	import("./routes/operations").then((page) => ({ default: page.SettingsPage })),
);
const EmbeddingPage = lazy(() =>
	import("./routes/operations").then((page) => ({ default: page.EmbeddingPage })),
);

function RouterLink({
	href,
	children,
	...props
}: { href: string; children?: ReactNode } & Record<string, unknown>) {
	return /^(https?:|mailto:|tel:)/.test(href) ? (
		<a href={href} {...props}>
			{children}
		</a>
	) : (
		<Link to={href} {...props}>
			{children}
		</Link>
	);
}

const router = createBrowserRouter(
	createRoutesFromElements(
		<Route element={<AppShell />}>
			<Route index element={<OverviewPage />} />
			<Route path="memories" element={<MemoriesPage />} />
			<Route path="memories/:id" element={<MemoryPage />} />
			<Route path="memories/:id/edit" element={<EditorPage />} />
			<Route path="memories/:id/history" element={<HistoryPage />} />
			<Route path="search" element={<SearchPage />} />
			<Route path="tags" element={<TagsPage />} />
			<Route path="spaces" element={<SpacesPage />} />
			<Route path="trash" element={<TrashPage />} />
			<Route path="graph" element={<GraphPage />} />
			<Route path="timeline" element={<TimelinePage />} />
			<Route path="keys" element={<KeysPage />} />
			<Route path="usage" element={<UsagePage />} />
			<Route path="audit" element={<AuditPage />} />
			<Route path="settings" element={<SettingsPage />} />
			<Route path="settings/embedding" element={<EmbeddingPage />} />
			<Route
				path="*"
				element={<PageHeader title="页面不存在" description="请从主导航选择页面。" />}
			/>
		</Route>,
	),
);

export function App() {
	return (
		<ThemeProvider>
			<AccentProvider defaultAccent="primary" persist={false}>
				<LinkProvider render={RouterLink}>
					<TooltipProvider>
						{notificationViewport}
						<RouterProvider router={router} />
					</TooltipProvider>
				</LinkProvider>
			</AccentProvider>
		</ThemeProvider>
	);
}
