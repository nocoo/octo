import { Toaster } from "@nocoo/basalt";
import { expect, it } from "vitest";
import { notificationViewport } from "./notifications";

it("localizes notification announcements without replacing Basalt presentation", () => {
	const defaults = Toaster({}).props;
	expect(notificationViewport.type).toBe(Toaster({}).type);
	expect(notificationViewport.props.containerAriaLabel).toBe("通知");
	expect(notificationViewport.props.toastOptions.closeButtonAriaLabel).toBe("关闭通知");
	expect(notificationViewport.props.toastOptions.unstyled).toBe(defaults.toastOptions.unstyled);
	expect(notificationViewport.props.toastOptions.classNames).toEqual(
		defaults.toastOptions.classNames,
	);
	expect(notificationViewport.props.icons).toEqual(defaults.icons);
});
