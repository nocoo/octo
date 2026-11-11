import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	ContentIsland,
	Dialog,
	DialogContent,
	DialogTitle,
	LayerCard,
	Link,
	Sidebar,
	SidebarBrand,
	SidebarDrawer,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarProvider,
	SidebarSearch,
	SidebarToggle,
	SidebarUser,
	ThemeToggle,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import { AppHeader, AppHeaderMenuButton, ProjectLinks } from "@nocoo/basalt/components/app-header";
import { AppMain, AppSkipLink, AppShell as Frame } from "@nocoo/basalt/components/app-shell";
import { Banner } from "@nocoo/basalt/components/banner";
import { Grid } from "@nocoo/basalt/components/grid";
import { Command } from "cmdk";
import {
	Activity,
	ArrowUpDown,
	BookOpen,
	Boxes,
	Clock3,
	CornerDownLeft,
	Database,
	KeyRound,
	LayoutDashboard,
	Network,
	Search,
	Settings,
	ShieldCheck,
	Tags,
	Trash2,
} from "lucide-react";
import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { APP_VERSION } from "../../../lib/version";
import {
	headerCrumbs,
	initials,
	navigation,
	pageTitle,
	shellModel,
	shortcut,
} from "../../viewmodels/shell";
import {
	isPlainLinkClick,
	navigateToMarkdownHeading,
	restoreMarkdownHeading,
} from "./markdown-navigation";
import { useModel } from "./use-model";

const ACCESS_LOGOUT_HREF = "https://nocoo.cloudflareaccess.com/cdn-cgi/access/logout";

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

const sidebarNavigation = navigation.filter((item) => item.href !== "/search");
const navigationGroups = [...new Set(navigation.map((item) => item.group))];

type Identity = {
	email: string | null;
	name: string | null;
	avatar: string | null;
	error: string | null;
};

function ShellSidebar({
	identity,
	collapsed,
	drawerDismiss = false,
	onDrawerDismiss,
	onOpenPalette,
	onNavigate,
}: {
	identity: Identity;
	collapsed: boolean;
	drawerDismiss?: boolean;
	onDrawerDismiss?: () => void;
	onOpenPalette: () => void;
	onNavigate: (path: string) => void;
}) {
	const identityLabel =
		identity.email ?? (identity.error ? "Access 身份未知" : "Access 身份验证中");
	const identityName = identity.name ?? identity.email?.split("@")[0] ?? identityLabel;
	const location = useLocation();
	const active = (href: string) =>
		href === "/"
			? location.pathname === "/"
			: location.pathname === href ||
				(href === "/memories" && location.pathname.startsWith("/memories/"));
	const avatar = (
		<Avatar role="img" aria-label={identityName}>
			{identity.avatar ? (
				<AvatarImage
					src={identity.avatar}
					alt={`${identityName} 的头像`}
					referrerPolicy="no-referrer"
				/>
			) : null}
			<AvatarFallback>{initials(identityName)}</AvatarFallback>
		</Avatar>
	);
	return (
		<Sidebar resizable={!drawerDismiss}>
			<SidebarHeader>
				<SidebarBrand
					logo={
						<Link href="/" aria-label="Octo 首页" onClick={() => onDrawerDismiss?.()}>
							<img src="/logo-24.png" srcSet="/logo-24.png 1x, /logo-48.png 2x" alt="Octo" />
						</Link>
					}
					name="octo"
					version={`v${APP_VERSION}`}
					action={
						drawerDismiss ? (
							<SidebarToggle
								mode="dismiss"
								onDismiss={() => onDrawerDismiss?.()}
								dismissLabel="关闭导航"
							/>
						) : (
							<SidebarToggle collapseLabel="收起侧栏" expandLabel="展开侧栏" />
						)
					}
				/>
			</SidebarHeader>
			<SidebarNav aria-label="主导航">
				<SidebarSearch onClick={onOpenPalette} shortcut="⌘ K">
					搜索与命令
				</SidebarSearch>
				{navigationGroups.map((group) => {
					const items = sidebarNavigation
						.filter((item) => item.group === group)
						.map((item) => {
							const Icon = icons[item.icon];
							const icon = (
								<Icon
									key={item.href}
									className="octo-nav-icon"
									size={18}
									strokeWidth={1.5}
									aria-hidden="true"
								/>
							);
							return collapsed ? (
								<Tooltip key={item.href}>
									<TooltipTrigger asChild>
										<SidebarIconItem
											active={active(item.href)}
											aria-current={active(item.href) ? "page" : undefined}
											aria-label={item.label}
											onClick={() => onNavigate(item.href)}
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
									onClick={() => onNavigate(item.href)}
								>
									{icon}
									<span>{item.label}</span>
								</SidebarItem>
							);
						});
					return collapsed ? (
						<Fragment key={group}>{items}</Fragment>
					) : (
						<SidebarGroup key={group} label={group} defaultOpen>
							{items}
						</SidebarGroup>
					);
				})}
			</SidebarNav>
			<SidebarFooter>
				<SidebarUser
					name={identityName}
					email={identityLabel}
					avatar={avatar}
					tooltip={`${identityName} · ${identityLabel}`}
					signOutHref={ACCESS_LOGOUT_HREF}
					signOutLabel="退出登录"
				/>
			</SidebarFooter>
		</Sidebar>
	);
}

export function AppShell() {
	const identity = useModel(shellModel);
	const location = useLocation();
	const navigate = useNavigate();
	const [collapsed, setCollapsed] = useState(false);
	const [mobile, setMobile] = useState(() => matchMedia("(max-width: 767px)").matches);
	const [drawer, setDrawer] = useState(false);
	const [palette, setPalette] = useState(false);
	const [query, setQuery] = useState("");
	const menuButton = useRef<HTMLButtonElement>(null);
	const paletteOpener = useRef<HTMLElement | null>(null);
	useEffect(() => {
		void shellModel.load();
	}, []);
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
		void navigate(path);
	}
	const sidebarProps = {
		identity,
		onOpenPalette: () => setPalette(true),
		onNavigate: go,
	};
	return (
		<Frame layout="responsive" className="basalt-ui">
			<AppSkipLink
				onClick={(event) => {
					if (!isPlainLinkClick(event)) return;
					event.preventDefault();
					navigateToMarkdownHeading("main-content");
				}}
			>
				跳到主内容
			</AppSkipLink>
			{mobile ? (
				<SidebarDrawer
					open={drawer}
					onOpenChange={setDrawer}
					returnFocusRef={menuButton}
					title="主导航"
					description="选择工作台页面"
				>
					<ShellSidebar
						{...sidebarProps}
						collapsed={false}
						drawerDismiss
						onDrawerDismiss={() => setDrawer(false)}
					/>
				</SidebarDrawer>
			) : (
				<SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed}>
					<ShellSidebar {...sidebarProps} collapsed={collapsed} />
				</SidebarProvider>
			)}
			<AppMain tabIndex={-1}>
				<AppHeader
					breadcrumbs={
						mobile ? headerCrumbs(location.pathname).slice(-1) : headerCrumbs(location.pathname)
					}
					leading={
						mobile ? (
							<AppHeaderMenuButton
								ref={menuButton}
								label="打开导航"
								onClick={() => setDrawer(true)}
							/>
						) : null
					}
					actions={
						<>
							<ProjectLinks
								github="nocoo/octo"
								hexly="octo"
								name="Octo"
								githubLabel="GitHub 仓库"
								hexlyLabel="Octo 项目主页"
								newTabLabel="在新标签页打开"
							/>
							<ThemeToggle
								aria-label="切换深色或浅色主题"
								labels={{
									light: "切换浅色主题",
									dark: "切换深色主题",
									system: "跟随系统主题",
								}}
							/>
						</>
					}
				/>
				<ContentIsland className="octo-island">
					{identity.error && (
						<Banner
							variant="error"
							role="alert"
							description={identity.error}
							action={<Banner.Action onClick={() => void shellModel.load()}>重试</Banner.Action>}
						/>
					)}
					<Suspense fallback={<LayerCard.Loading label="正在加载页面…" />}>
						<RouteContent />
					</Suspense>
				</ContentIsland>
			</AppMain>
			<Dialog
				open={palette}
				onOpenChange={(open) => {
					setPalette(open);
					if (!open) setQuery("");
				}}
			>
				<DialogContent
					size="lg"
					className="octo-command-dialog"
					aria-describedby={undefined}
					onOpenAutoFocus={() => {
						paletteOpener.current = document.activeElement as HTMLElement;
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						paletteOpener.current?.focus();
					}}
				>
					<DialogTitle className="sr-only">搜索与命令</DialogTitle>
					<Command label="搜索页面或记忆" className="octo-command-root">
						<CommandInput
							aria-label="搜索页面或记忆"
							placeholder="跳转页面，或搜索记忆…"
							value={query}
							onValueChange={setQuery}
						/>
						<CommandList label="搜索结果" className="octo-command-list">
							{query.trim() && (
								<CommandGroup heading="搜索记忆" forceMount>
									<CommandItem
										value="search-memories"
										forceMount
										onSelect={() => go(`/search?q=${encodeURIComponent(query.trim())}`)}
									>
										<Search aria-hidden="true" />
										<span className="octo-command-label">搜索记忆：{query.trim()}</span>
										<CornerDownLeft className="octo-command-enter" aria-hidden="true" />
									</CommandItem>
								</CommandGroup>
							)}
							{navigationGroups.map((group) => (
								<CommandGroup key={group} heading={group}>
									{navigation
										.filter((item) => item.group === group)
										.map((item) => {
											const Icon = icons[item.icon];
											return (
												<CommandItem
													key={item.href}
													value={`${item.label} ${item.href}`}
													onSelect={() => go(item.href)}
												>
													<Icon aria-hidden="true" />
													<span className="octo-command-label">{item.label}</span>
													<CornerDownLeft className="octo-command-enter" aria-hidden="true" />
												</CommandItem>
											);
										})}
								</CommandGroup>
							))}
						</CommandList>
						<Grid className="octo-command-footer">
							<span>
								<ArrowUpDown aria-hidden="true" />
								选择
							</span>
							<span>
								<CornerDownLeft aria-hidden="true" />
								打开
							</span>
							<span>
								<kbd>Esc</kbd>关闭
							</span>
						</Grid>
					</Command>
				</DialogContent>
			</Dialog>
		</Frame>
	);
}

function RouteContent() {
	const { pathname, hash } = useLocation();
	const previousPath = useRef<string | null>(null);
	useEffect(() => {
		const previous = window.history.scrollRestoration;
		window.history.scrollRestoration = "manual";
		return () => {
			window.history.scrollRestoration = previous;
		};
	}, []);
	useEffect(() => {
		const target = `${pathname}${hash}`;
		if (previousPath.current === target) return;
		previousPath.current = target;
		if (restoreMarkdownHeading(hash)) return;
		document.querySelector("[data-basalt-island]")?.scrollTo(0, 0);
		window.scrollTo(0, 0);
	}, [pathname, hash]);
	return <Outlet />;
}
