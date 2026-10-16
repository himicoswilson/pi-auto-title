// Pure policy for pi-auto-title: configuration parsing and cleanup of
// generated titles. Nothing here touches Pi or the network, which is why
// it is unit-tested rather than live-tested.

export const DEFAULT_MAX_LENGTH = 60;
export const PROMPT_MAX_CHARS = 1500;
export const REPLY_MAX_CHARS = 500;
export const GENERATE_TIMEOUT_MS = 15_000;
export const GENERATE_MAX_TOKENS = 64;

/** Trailing punctuation a generated title should not end with. */
const trailingPunctuation = /[.。!！?？;；,，、:：)\]}"'\s]+$/u;

/** Wrapping decorations a model may put around its answer. */
const wrappingPairs: Array<[string, string]> = [
	['"', '"'],
	["'", "'"],
	["\u201c", "\u201d"],
	["\u300c", "\u300d"],
	["\u300e", "\u300f"],
	["`", "`"],
	["*", "*"],
];

/**
 * Turn a model's raw output into a usable session title. Takes the first
 * line, strips wrapping quotes or brackets, collapses whitespace, drops
 * trailing punctuation, and caps the length. Returns null when nothing
 * title-worthy remains.
 */
export function sanitizeTitle(raw: string, maxLength: number): string | null {
	if (maxLength <= 0) {
		return null;
	}

	let title = raw.split("\n", 1)[0].trim();

	let unwrapped = true;
	while (unwrapped && title.length >= 2) {
		unwrapped = false;
		for (const [open, close] of wrappingPairs) {
			if (title.startsWith(open) && title.endsWith(close)) {
				title = title.slice(open.length, title.length - close.length).trim();
				unwrapped = true;
				break;
			}
		}
	}

	title = title.replace(/\s+/gu, " ").replace(trailingPunctuation, "");
	if (title === "") {
		return null;
	}

	if ([...title].length > maxLength) {
		title = [...title].slice(0, maxLength).join("").trim();
		if (title === "") {
			return null;
		}
	}

	return title;
}

/** Parse "provider/model-id" into its parts; null when the shape is wrong. */
export function parseModelRef(ref: string): { provider: string; modelId: string } | null {
	const slash = ref.indexOf("/");
	if (slash <= 0) {
		return null;
	}

	const provider = ref.slice(0, slash).trim();
	const modelId = ref.slice(slash + 1).trim();
	if (provider === "" || modelId === "") {
		return null;
	}

	return { provider, modelId };
}

/**
 * Whether titling is enabled. Unset means on; the usual "false" spellings
 * turn it off.
 */
export function isEnabled(value: string | undefined): boolean {
	if (value === undefined) {
		return true;
	}

	return !["0", "false", "off", "no", "n"].includes(value.trim().toLowerCase());
}

/** Maximum title length from the environment, with a sane fallback. */
export function maxLengthFromEnv(value: string | undefined): number {
	if (value === undefined) {
		return DEFAULT_MAX_LENGTH;
	}

	const n = Math.floor(Number(value));
	if (!Number.isFinite(n) || n <= 0) {
		return DEFAULT_MAX_LENGTH;
	}

	return n;
}
