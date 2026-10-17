import pkg from "../../../../package.json" with { type: "json" };

export function versionLabel(version: string, name = "octo"): string {
	return `${name}/${version}`;
}

export const APP_VERSION: string = pkg.version;
