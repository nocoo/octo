import { describe, expect, it, vi } from "vitest";
import { Store } from "./store";

class Counter extends Store<{ count: number }> {
	increment() {
		this.set({ count: this.state.count + 1 });
	}
}

describe("observable view state", () => {
	it("publishes immutable snapshots and unsubscribes", () => {
		const model = new Counter({ count: 0 });
		const initial = model.getSnapshot();
		const listener = vi.fn();
		const unsubscribe = model.subscribe(listener);
		model.increment();
		expect(initial.count).toBe(0);
		expect(model.getSnapshot()).toEqual({ count: 1 });
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		model.increment();
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
