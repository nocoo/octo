import { defineConfig } from "vite";
import { DEV_VITE_PORT, DEV_WORKER_PORT } from "./scripts/ports";

export default defineConfig({
	root: "apps/web",
	build: {
		outDir: "../../dist/client",
		emptyOutDir: true,
	},
	server: {
		host: "127.0.0.1",
		port: DEV_VITE_PORT,
		strictPort: true,
		allowedHosts: ["octo.dev.hexly.ai"],
		hmr: {
			host: "octo.dev.hexly.ai",
			protocol: "wss",
			clientPort: 443,
		},
		proxy: {
			"/api": `http://127.0.0.1:${DEV_WORKER_PORT}`,
			"/files": `http://127.0.0.1:${DEV_WORKER_PORT}`,
			"/mcp": `http://127.0.0.1:${DEV_WORKER_PORT}`,
		},
	},
});
