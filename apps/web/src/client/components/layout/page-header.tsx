import { Button } from "@nocoo/basalt";
import { Grid } from "@nocoo/basalt/components/grid";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { backTarget } from "../../viewmodels/shell";

export interface PageHeaderProps {
	/** The page heading, rendered as the only `h1`. */
	title: ReactNode;
	/** Inline suffix beside the title: counts, ranges or one short note. */
	meta?: ReactNode;
	/** One row of filters, view switches and actions; the primary action stays last. */
	actions?: ReactNode;
}

export function PageHeader({ title, meta, actions }: PageHeaderProps) {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	return (
		<Grid columns={1} className="octo-page-header">
			<Grid columns={1} className="octo-page-heading">
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
				<h1 className="octo-page-title">{title}</h1>
				{meta ? (
					<p className="octo-page-meta" {...(typeof meta === "string" ? { title: meta } : {})}>
						{meta}
					</p>
				) : null}
			</Grid>
			{actions ? (
				<Grid columns={1} className="octo-page-actions">
					{actions}
				</Grid>
			) : null}
		</Grid>
	);
}
