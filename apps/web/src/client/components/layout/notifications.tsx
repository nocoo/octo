import { Toaster } from "@nocoo/basalt";
import { cloneElement } from "react";

const basaltViewport = Toaster({ containerAriaLabel: "通知" });

export const notificationViewport = cloneElement(basaltViewport, {
	toastOptions: {
		...basaltViewport.props.toastOptions,
		closeButtonAriaLabel: "关闭通知",
	},
});
