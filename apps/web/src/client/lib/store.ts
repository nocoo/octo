export class Store<State> {
	private readonly listeners = new Set<() => void>();
	constructor(public state: State) {}
	getSnapshot = (): State => this.state;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	protected set(patch: Partial<State>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
}
