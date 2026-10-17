import { LinkProvider, ThemeProvider, Toaster, TooltipProvider } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import type { ReactNode } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { AppShell } from "./components/layout/app-shell";

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

export function App() {
	return (
		<ThemeProvider>
			<AccentProvider defaultAccent="primary" persist={false}>
				<LinkProvider render={RouterLink}>
					<TooltipProvider>
						<BrowserRouter>
							<Toaster />
							<Routes>
								<Route element={<AppShell />}>
									<Route
										index
										element={<PageHeader title="总览" description="每一条记忆，都有迹可循。" />}
									/>
									<Route
										path="*"
										element={<PageHeader title="页面不存在" description="请从主导航选择页面。" />}
									/>
								</Route>
							</Routes>
						</BrowserRouter>
					</TooltipProvider>
				</LinkProvider>
			</AccentProvider>
		</ThemeProvider>
	);
}
