import { describe, expect, it } from "vitest";
import { validateEmbeddingUrl } from "./url";

describe("embedding URL policy", () => {
	it("canonicalizes an HTTPS gateway path", () => {
		expect(validateEmbeddingUrl("https://GATEWAY.example/prefix/", "production")).toBe(
			"https://gateway.example/prefix",
		);
	});
	it.each([
		"http://gateway.example",
		"ftp://gateway.example",
		"https://u:p@gateway.example",
		"https://gateway.example?secret=x",
		"https://gateway.example#x",
		"https://gateway.example?",
		"https://gateway.example#",
		"not a url",
		"https://gateway.example/\x00",
		"https://gateway.example/\x7f",
		" https://gateway.example",
		"https://gateway.example\\evil",
		"https://10.0.0.1",
		"https://172.16.0.1",
		"https://172.31.255.255",
		"https://192.168.1.1",
		"https://169.254.169.254",
		"https://100.64.0.1",
		"https://0.0.0.0",
		"https://224.0.0.1",
		"https://198.18.0.1",
		"https://192.0.0.1",
		"https://127.1",
		"https://2130706433",
		"https://[::1]",
		"https://[::]",
		"https://[::ffff:127.0.0.1]",
		"https://[fc00::1]",
		"https://[fe80::1]",
		"https://localhost",
		"https://localhost.",
		"https://a.local",
		"https://metadata.google.internal",
		"https://single-label",
	])("rejects unsafe production URL %s", (url) => {
		expect(() => validateEmbeddingUrl(url, "production")).toThrow("invalid embedding base URL");
	});
	it.each(["http://127.0.0.1:9999/", "http://localhost:9999", "http://[::1]:9999"])(
		"permits local gateways only in explicit local modes (%s)",
		(url) => {
			for (const mode of ["test", "development"])
				expect(validateEmbeddingUrl(url, mode)).toContain(":9999");
			for (const mode of [undefined, "production", "other"])
				expect(() => validateEmbeddingUrl(url, mode)).toThrow();
		},
	);
	it.each([
		"http://10.0.0.1",
		"http://gateway.example",
		"https://169.254.0.1",
		"http://a.localhost",
	])("rejects non-loopback local exceptions (%s)", (url) => {
		expect(() => validateEmbeddingUrl(url, "test")).toThrow();
	});
	it.each(["https://8.8.8.8", "https://[2606:4700:4700::1111]", "https://gateway.example."])(
		"permits public addresses (%s)",
		(url) => {
			expect(validateEmbeddingUrl(url, "production")).toBe(url);
		},
	);
});
