const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newUlid(now = Date.now()): string {
	let time = now;
	const chars: string[] = [];
	for (let i = 0; i < 10; i++) {
		chars.unshift(ALPHABET.charAt(time % 32));
		time = Math.floor(time / 32);
	}
	const rand = crypto.getRandomValues(new Uint8Array(16));
	for (const byte of rand) {
		chars.push(ALPHABET.charAt(byte % 32));
	}
	return chars.join("").slice(0, 26);
}
