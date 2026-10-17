import "@nocoo/basalt/styles/standalone";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./index.css";

let stored: string | null = null;
try {
	stored = localStorage.getItem("theme");
} catch {}
const dark =
	stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark", dark);
document.documentElement.classList.toggle("light", !dark);
document.documentElement.dataset.mode = dark ? "dark" : "light";
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
