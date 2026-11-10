import { Button } from "@nocoo/basalt";
import { Grid } from "@nocoo/basalt/components/grid";
import {
	PageHeader as BasaltPageHeader,
	type PageHeaderProps as BasaltPageHeaderProps,
} from "@nocoo/basalt/components/page-header";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { backTarget } from "../../viewmodels/shell";

export type PageHeaderProps = BasaltPageHeaderProps;

function PageBackButton() {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	return (
		<Button
			variant="ghost"
			size="icon"
			className="octo-page-back"
			aria-label="返回上一页"
			title="返回上一页"
			onClick={() => {
				const target = backTarget(pathname, window.history.state?.idx);
				if (target === -1) void navigate(-1);
				else void navigate(target, { replace: true });
			}}
		>
			<ArrowLeft size={20} strokeWidth={1.5} aria-hidden="true" />
		</Button>
	);
}

/**
 * Back button + Basalt PageHeader (title, description) + actions. Actions stay a sibling of the
 * heading instead of Basalt's own `actions` slot: that slot switches to a row at the `md` viewport
 * breakpoint and, beside the sidebar on tablets, crushes the title to one glyph per line. As a
 * wrapping sibling the actions move to their own row once the heading needs the width.
 */
export function PageHeader({ actions, ...props }: PageHeaderProps) {
	return (
		<Grid
			columns={1}
			className="octo-page-header"
			style={{
				display: "flex",
				flexWrap: "wrap",
				alignItems: "flex-start",
				columnGap: "var(--basalt-space-layout)",
				rowGap: "var(--basalt-space-sm)",
				minWidth: 0,
			}}
		>
			<PageBackButton />
			<Grid columns={1} style={{ flex: "1 1 auto", minInlineSize: 0 }}>
				<BasaltPageHeader {...props} />
			</Grid>
			{actions ? (
				<Grid
					columns={1}
					data-octo-page-actions=""
					style={{
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						gap: "var(--basalt-space-sm)",
						marginInlineStart: "auto",
					}}
				>
					{actions}
				</Grid>
			) : null}
		</Grid>
	);
}
