import { useSyncExternalStore } from "react";
import type { Store } from "../../lib/store";

export function useModel<State>(model: Store<State>): State {
	return useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
}
