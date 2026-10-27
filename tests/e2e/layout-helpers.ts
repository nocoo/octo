import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/** Matches `@container memory-reader (min-width: 60rem)` in markdown.css. */
export const MEMORY_READER_WIDE_MIN_PX = 960;

export async function expectMemoryReaderContainerWide(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page
				.locator(".octo-memory-reader")
				.evaluate((reader, minWide) => reader.clientWidth >= minWide, MEMORY_READER_WIDE_MIN_PX),
		)
		.toBe(true);
}

export async function expectMemoryReaderContainerNarrow(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page
				.locator(".octo-memory-reader")
				.evaluate((reader, minWide) => reader.clientWidth < minWide, MEMORY_READER_WIDE_MIN_PX),
		)
		.toBe(true);
}

export async function expectDesktopMemoryRailGeometry(page: Page): Promise<void> {
	await expectMemoryReaderContainerWide(page);
	await expect
		.poll(() =>
			page.locator(".octo-memory-layout").evaluate((layout) => {
				const body = layout.firstElementChild;
				const aside = layout.querySelector(".octo-memory-aside");
				const island = layout.closest(".octo-island");
				if (!body || !aside || !island) return false;
				const bodyBox = body.getBoundingClientRect();
				const asideBox = aside.getBoundingClientRect();
				const bottom =
					island.getBoundingClientRect().bottom -
					Number.parseFloat(getComputedStyle(island).paddingBottom);
				return (
					asideBox.width === 384 &&
					bodyBox.width > 400 &&
					bodyBox.bottom >= asideBox.bottom - 1 &&
					bodyBox.bottom >= bottom - 1
				);
			}),
		)
		.toBe(true);
}

export async function expectStackedMemoryColumns(page: Page): Promise<void> {
	await expectMemoryReaderContainerNarrow(page);
	await expect
		.poll(() =>
			page.locator(".octo-memory-layout").evaluate((layout) => {
				const body = layout.firstElementChild;
				const aside = layout.querySelector(".octo-memory-aside");
				if (!body || !aside) return false;
				const bodyBox = body.getBoundingClientRect();
				const asideBox = aside.getBoundingClientRect();
				return Math.abs(asideBox.x - bodyBox.x) < 1 && asideBox.y >= bodyBox.y + bodyBox.height - 1;
			}),
		)
		.toBe(true);
}
