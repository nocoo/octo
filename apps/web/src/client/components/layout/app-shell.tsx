import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Button,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandPalette,
	ContentIsland,
	Link,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
	Sidebar,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarSearch,
	SidebarUser,
	ThemeToggle,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import { AppMain, AppSkipLink, AppShell as Frame } from "@nocoo/basalt/components/app-shell";
import { Banner } from "@nocoo/basalt/components/banner";
import { Grid } from "@nocoo/basalt/components/grid";
import { LayerCard } from "@nocoo/basalt/components/layer-card";
import {
	Activity,
	BookOpen,
	Boxes,
	Clock3,
	Database,
	KeyRound,
	LayoutDashboard,
	Menu,
	Network,
	PanelLeftClose,
	PanelLeftOpen,
	Search,
	Settings,
	ShieldCheck,
	Tags,
	Trash2,
} from "lucide-react";
import { Fragment, type ReactElement, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Outlet, useLocation, useNavigate } from "react-router";
import { APP_VERSION } from "../../../lib/version";
import {
	headerCrumbs,
	initials,
	navigation,
	pageTitle,
	ShellModel,
	shortcut,
} from "../../viewmodels/shell";
import { useModel } from "./use-model";

const icons = {
	overview: LayoutDashboard,
	memories: BookOpen,
	search: Search,
	graph: Network,
	timeline: Clock3,
	tags: Tags,
	spaces: Boxes,
	keys: KeyRound,
	usage: Activity,
	audit: ShieldCheck,
	trash: Trash2,
	embedding: Database,
	settings: Settings,
};

function HeaderHint({ label, children }: { label: string; children: ReactElement }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

export function AppShell() {
	const model = useMemo(() => new ShellModel(), []);
	const identity = useModel(model);
	const identityLabel =
		identity.email ?? (identity.error ? "Access 身份未知" : "Access 身份验证中");
	const identityName = identity.name ?? identity.email?.split("@")[0] ?? identityLabel;
	const location = useLocation();
	const navigate = useNavigate();
	const [collapsed, setCollapsed] = useState(false);
	const [mobile, setMobile] = useState(() => matchMedia("(max-width: 767px)").matches);
	const [drawer, setDrawer] = useState(false);
	const [palette, setPalette] = useState(false);
	const [query, setQuery] = useState("");
	const menuButton = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		void model.load();
	}, [model]);
	useEffect(() => {
		const media = matchMedia("(max-width: 767px)");
		const update = () => {
			setMobile(media.matches);
			setDrawer(false);
		};
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	useEffect(() => {
		document.title = `${pageTitle(location.pathname)} · Octo`;
		setDrawer(false);
	}, [location.pathname]);
	useEffect(() => {
		const handleKey = (event: KeyboardEvent) => {
			const target = event.target;
			const editable =
				target instanceof HTMLElement &&
				(target.isContentEditable || !!target.closest("input,textarea,select,[role=combobox]"));
			const action = shortcut(event.key, event.metaKey || event.ctrlKey, editable);
			if (!action || event.altKey) return;
			event.preventDefault();
			if (action === "palette") setPalette((current) => !current);
			else {
				const search = document.querySelector<HTMLInputElement>("[data-search-input]");
				if (search) search.focus();
				else void navigate("/search", { state: { focusSearch: true } });
			}
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [navigate]);
	function go(path: string) {
		setDrawer(false);
		setPalette(false);
		setQuery("");
		if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
			document.startViewTransition(() =>
				flushSync(() => {
					void navigate(path);
				}),
			);
		} else void navigate(path);
	}
	const active = (href: string) =>
		href === "/"
			? location.pathname === "/"
			: location.pathname === href ||
				(href === "/memories" && location.pathname.startsWith("/memories/"));
	function rail(isCollapsed: boolean) {
		const avatar = (
			<Avatar
				className="octo-avatar"
				role="img"
				aria-label={isCollapsed ? `${identityName} · ${identityLabel}` : identityName}
				tabIndex={isCollapsed ? 0 : undefined}
			>
				{identity.avatar && (
					<AvatarImage src={identity.avatar} alt="" referrerPolicy="no-referrer" />
				)}
				<AvatarFallback>{initials(identityName)}</AvatarFallback>
			</Avatar>
		);
		return (
			<Sidebar collapsed={isCollapsed}>
				<SidebarHeader>
					<Grid className="octo-brand-row">
						<Link
							href="/"
							className="octo-home-link"
							aria-label="Octo 首页"
							onClick={() => setDrawer(false)}
						>
							<img
								src="/logo-24.png"
								srcSet="/logo-24.png 1x, /logo-48.png 2x"
								width={28}
								height={28}
								alt="Octo"
							/>
							{!isCollapsed && (
								<>
									<strong className="octo-brand-title">Octo</strong>
									<span className="octo-version">v{APP_VERSION}</span>
								</>
							)}
						</Link>
						{!isCollapsed && (
							<Button
								variant="ghost"
								size="icon"
								className="octo-collapse"
								aria-label="收起侧栏"
								aria-expanded={!collapsed}
								onClick={() => (mobile ? setDrawer(false) : setCollapsed(true))}
							>
								<PanelLeftClose strokeWidth={1.5} aria-hidden="true" />
							</Button>
						)}
					</Grid>
				</SidebarHeader>
				{isCollapsed ? (
					<Button
						variant="ghost"
						size="icon"
						className="octo-expand"
						aria-label="展开侧栏"
						aria-expanded={false}
						onClick={() => setCollapsed(false)}
					>
						<PanelLeftOpen strokeWidth={1.5} aria-hidden="true" />
					</Button>
				) : (
					<Grid columns={1} className="octo-search-inset">
						<SidebarSearch onClick={() => setPalette(true)} shortcut="⌘ K">
							搜索与命令
						</SidebarSearch>
					</Grid>
				)}
				<SidebarNav aria-label="主导航">
					{isCollapsed && (
						<Tooltip>
							<TooltipTrigger asChild>
								<SidebarIconItem aria-label="搜索命令 (⌘K)" onClick={() => setPalette(true)}>
									<Search size={16} strokeWidth={1.5} aria-hidden="true" />
								</SidebarIconItem>
							</TooltipTrigger>
							<TooltipContent side="right">搜索与命令 · ⌘ K</TooltipContent>
						</Tooltip>
					)}
					{Array.from(new Set(navigation.map((item) => item.group))).map((group) => {
						const items = navigation
							.filter((item) => item.group === group)
							.map((item) => {
								const Icon = icons[item.icon];
								const icon = (
									<Icon
										key={item.href}
										className="octo-nav-icon"
										data-tone={item.group}
										size={16}
										strokeWidth={1.5}
										aria-hidden="true"
									/>
								);
								return isCollapsed ? (
									<Tooltip key={item.href}>
										<TooltipTrigger asChild>
											<SidebarIconItem
												active={active(item.href)}
												aria-current={active(item.href) ? "page" : undefined}
												aria-label={item.label}
												onClick={() => go(item.href)}
											>
												{icon}
											</SidebarIconItem>
										</TooltipTrigger>
										<TooltipContent side="right">{item.label}</TooltipContent>
									</Tooltip>
								) : (
									<SidebarItem
										key={item.href}
										active={active(item.href)}
										aria-current={active(item.href) ? "page" : undefined}
										onClick={() => go(item.href)}
									>
										{icon}
										<span>{item.label}</span>
									</SidebarItem>
								);
							});
						return isCollapsed ? (
							<Fragment key={group}>{items}</Fragment>
						) : (
							<SidebarGroup key={group} label={group} defaultOpen>
								{items}
							</SidebarGroup>
						);
					})}
				</SidebarNav>
				<SidebarFooter>
					{isCollapsed ? (
						<Tooltip>
							<TooltipTrigger asChild>{avatar}</TooltipTrigger>
							<TooltipContent side="right">
								{identityName} · {identityLabel}
							</TooltipContent>
						</Tooltip>
					) : (
						<SidebarUser name={identityName} email={identityLabel} avatar={avatar} />
					)}
				</SidebarFooter>
			</Sidebar>
		);
	}
	return (
		<Frame layout="responsive" className="basalt-ui">
			<AppSkipLink>跳到主内容</AppSkipLink>
			{mobile ? (
				<Sheet open={drawer} onOpenChange={setDrawer}>
					<SheetContent
						side="left"
						className="octo-mobile-rail"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							menuButton.current?.focus();
						}}
					>
						<SheetTitle className="sr-only">主导航</SheetTitle>
						<SheetDescription className="sr-only">选择工作台页面</SheetDescription>
						{rail(false)}
					</SheetContent>
				</Sheet>
			) : (
				rail(collapsed)
			)}
			<AppMain tabIndex={-1}>
				<AppHeader
					className="octo-header"
					breadcrumbs={
						mobile ? headerCrumbs(location.pathname).slice(-1) : headerCrumbs(location.pathname)
					}
					leading={
						mobile ? (
							<Button
								ref={menuButton}
								variant="ghost"
								size="icon"
								aria-label="打开导航"
								onClick={(event) => {
									event.currentTarget.focus();
									setDrawer(true);
								}}
							>
								<Menu aria-hidden="true" />
							</Button>
						) : null
					}
					actions={
						<>
							<HeaderHint label="搜索与命令 · ⌘ K">
								<Button
									variant="ghost"
									size="icon"
									className="octo-header-link"
									aria-label="搜索与命令"
									onClick={() => setPalette(true)}
								>
									<Search strokeWidth={1.5} aria-hidden="true" />
								</Button>
							</HeaderHint>
							<HeaderHint label="GitHub 仓库 · 在新标签页打开">
								<Button variant="ghost" size="icon" className="octo-header-link" asChild>
									<a
										href="https://github.com/nocoo/octo"
										target="_blank"
										rel="noopener noreferrer"
										aria-label="GitHub 仓库"
									>
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth={1.5}
											strokeLinecap="round"
											strokeLinejoin="round"
											aria-hidden="true"
										>
											<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
											<path d="M9 18c-4.51 2-5-2-7-2" />
										</svg>
										<span className="sr-only">GitHub 仓库</span>
									</a>
								</Button>
							</HeaderHint>
							<HeaderHint label="Octo 项目主页 · 在新标签页打开">
								<Button variant="ghost" size="icon" className="octo-header-link" asChild>
									<a
										href="https://hexly.ai/projects/octo"
										target="_blank"
										rel="noopener noreferrer"
										aria-label="Octo 项目主页"
									>
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth={1.5}
											strokeLinecap="round"
											strokeLinejoin="round"
											aria-hidden="true"
										>
											<path d="m12 2 8.66 5v10L12 22l-8.66-5V7Z" />
											<path d="M12 2v20M3.34 7l17.32 10m0-10L3.34 17" />
										</svg>
										<span className="sr-only">Octo 项目主页</span>
									</a>
								</Button>
							</HeaderHint>
							<HeaderHint label="切换深色或浅色主题">
								<ThemeToggle aria-label="切换深色或浅色主题" />
							</HeaderHint>
						</>
					}
				/>
				<ContentIsland className="octo-island">
					{identity.error && (
						<Banner
							variant="error"
							role="alert"
							description={identity.error}
							action={<Banner.Action onClick={() => void model.load()}>重试</Banner.Action>}
						/>
					)}
					<Suspense fallback={<LayerCard.Loading label="正在加载页面…" />}>
						<Outlet />
					</Suspense>
				</ContentIsland>
			</AppMain>
			<CommandPalette
				open={palette}
				onOpenChange={(open) => {
					setPalette(open);
					if (!open) setQuery("");
				}}
			>
				<CommandInput
					aria-label="搜索页面或记忆"
					placeholder="跳转页面，或搜索记忆…"
					value={query}
					onValueChange={setQuery}
				/>
				<CommandList label="搜索结果">
					<CommandEmpty>没有匹配页面，按搜索命令查找记忆。</CommandEmpty>
					<CommandGroup heading="页面">
						{navigation.map((item) => (
							<CommandItem
								key={item.href}
								value={`${item.label} ${item.href}`}
								onSelect={() => go(item.href)}
							>
								{item.label}
							</CommandItem>
						))}
					</CommandGroup>
					{query.trim() && (
						<CommandGroup heading="记忆">
							<CommandItem
								value={query}
								onSelect={() => go(`/search?q=${encodeURIComponent(query.trim())}`)}
							>
								搜索记忆：{query}
							</CommandItem>
						</CommandGroup>
					)}
				</CommandList>
			</CommandPalette>
		</Frame>
	);
}
