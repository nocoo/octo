const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number): string {
	let t = time;
	let out = "";
	for (let i = 0; i < 10; i++) {
		out = ENCODING[t % 32] + out;
		t = Math.floor(t / 32);
	}
	return out;
}

function encodeRandom(bytes: Uint8Array): string {
	let out = "";
	let value = 0;
	let bits = 0;
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += ENCODING[(value >> bits) & 31];
		}
	}
	if (bits > 0) {
		out += ENCODING[(value << (5 - bits)) & 31];
	}
	return out;
}

export function newUlid(now = Date.now()): string {
	const random = crypto.getRandomValues(new Uint8Array(16));
	return encodeTime(now) + encodeRandom(random).padEnd(16, "0").slice(0, 16);
}
