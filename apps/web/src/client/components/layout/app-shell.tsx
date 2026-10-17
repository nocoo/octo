import {
	Avatar,
	AvatarFallback,
	Badge,
	Button,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandPalette,
	ContentIsland,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
	Sidebar,
	SidebarFooter,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarPartition,
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
import { LayerCard } from "@nocoo/basalt/components/layer-card";
import { Text } from "@nocoo/basalt/components/text";
import {
	Activity,
	BookOpen,
	Boxes,
	Clock3,
	Database,
	ExternalLink,
	KeyRound,
	LayoutDashboard,
	Menu,
	Network,
	PanelLeft,
	Search,
	Settings,
	ShieldCheck,
	Tags,
	Trash2,
} from "lucide-react";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Outlet, useLocation, useNavigate } from "react-router";
import { APP_VERSION } from "../../../lib/version";
import { navigation, pageTitle, ShellModel, shortcut } from "../../viewmodels/shell";
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

export function AppShell() {
	const model = useMemo(() => new ShellModel(), []);
	const identity = useModel(model);
	const identityLabel =
		identity.email ?? (identity.error ? "Access 身份未知" : "Access 身份验证中");
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
		return (
			<Sidebar collapsed={isCollapsed}>
				<SidebarHeader>
					{!isCollapsed && (
						<>
							<Text as="strong" variant="heading" size="xl">
								Octo
							</Text>
							<Badge variant="secondary">v{APP_VERSION}</Badge>
						</>
					)}
					<Button
						variant="ghost"
						size="icon"
						aria-label={isCollapsed ? "展开侧栏" : "收起侧栏"}
						onClick={() => (mobile ? setDrawer(false) : setCollapsed(!collapsed))}
					>
						<PanelLeft aria-hidden="true" />
					</Button>
				</SidebarHeader>
				<SidebarNav aria-label="主导航">
					{!isCollapsed && (
						<SidebarSearch onClick={() => setPalette(true)} shortcut="⌘ K">
							搜索与命令
						</SidebarSearch>
					)}
					{Array.from(new Set(navigation.map((item) => item.group))).map((group) => (
						<Fragment key={group}>
							{!isCollapsed && <SidebarPartition>{group}</SidebarPartition>}
							{navigation
								.filter((item) => item.group === group)
								.map((item) => {
									const Icon = icons[item.icon];
									const icon = (
										<Icon key={item.href} size={16} strokeWidth={1.5} aria-hidden="true" />
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
								})}
						</Fragment>
					))}
				</SidebarNav>
				<SidebarFooter>
					{isCollapsed ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" aria-label={identityLabel}>
									<Avatar>
										<AvatarFallback>
											<ShieldCheck size={16} />
										</AvatarFallback>
									</Avatar>
								</Button>
							</TooltipTrigger>
							<TooltipContent side="right">{identityLabel}</TooltipContent>
						</Tooltip>
					) : (
						<SidebarUser
							name="私人知识工作台"
							email={identityLabel}
							avatar={
								<Avatar>
									<AvatarFallback>
										<ShieldCheck size={16} />
									</AvatarFallback>
								</Avatar>
							}
						/>
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
					density="compact"
					breadcrumbs={[
						...(location.pathname === "/" ? [] : [{ href: "/", label: "工作台" }]),
						{ label: pageTitle(location.pathname) },
					]}
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
						) : undefined
					}
					actions={
						<>
							<Button
								variant="ghost"
								size="icon"
								aria-label="搜索与命令"
								onClick={() => setPalette(true)}
							>
								<Search aria-hidden="true" />
							</Button>
							<Button variant="ghost" size="icon" asChild>
								<a
									href="https://github.com/nocoo/octo"
									target="_blank"
									rel="noopener noreferrer"
									aria-label="GitHub 仓库"
								>
									<ExternalLink aria-hidden="true" />
								</a>
							</Button>
							<ThemeToggle aria-label="切换深色或浅色主题" />
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
