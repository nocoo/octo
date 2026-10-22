import { Button } from "@nocoo/basalt";
import { Grid } from "@nocoo/basalt/components/grid";
import {
	PageHeader as BasaltPageHeader,
	type PageHeaderProps,
} from "@nocoo/basalt/components/page-header";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { backTarget } from "../../viewmodels/shell";

export function PageHeader(props: PageHeaderProps) {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	return (
		<Grid className="octo-page-header" style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}>
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
			<BasaltPageHeader {...props} />
		</Grid>
	);
}
