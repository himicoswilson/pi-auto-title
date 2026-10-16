// Wiring only: hook Pi's extension events, keep the titling state machine,
// and register the /retitle command. Generation itself lives in
// generate.ts; the rules that keep it out of the user's way live below.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateTitle } from "./generate.ts";
import { isEnabled, PROMPT_MAX_CHARS, REPLY_MAX_CHARS } from "./policy.ts";

const ENABLE_ENV = "PI_AUTO_TITLE";
const MODEL_ENV = "PI_AUTO_TITLE_MODEL";

/** Per-session state. Reset whenever a session starts. */
interface TitlerState {
	/** The title this extension set, if any. */
	titledByMe: string | null;
	/** The user took over the name; never auto-title again this session. */
	stoodDown: boolean;
	/** A generation is in flight. */
	inFlight: boolean;
}

function freshState(): TitlerState {
	return { titledByMe: null, stoodDown: false, inFlight: false };
}

export default function (pi: ExtensionAPI) {
	const state = freshState();

	pi.on("session_start", () => {
		Object.assign(state, freshState());
	});

	// The agent has finished its turn: the reply is delivered and nothing is
	// blocked anymore. The promise is deliberately not returned to Pi.
	pi.on("agent_settled", (event, ctx) => {
		if (event.aborted || !isEnabled(process.env[ENABLE_ENV])) {
			return;
		}

		void settleTitling(pi, ctx, state).catch(() => {});
	});

	// A name that is not ours means the user took over: stand down for the
	// rest of this session, whether they renamed it or cleared it.
	pi.on("session_info_changed", () => {
		if (pi.getSessionName() !== state.titledByMe) {
			state.stoodDown = true;
		}
	});

	pi.registerCommand("retitle", {
		description: "Generate a new automatic title for this session",
		handler: async (_args, ctx) => {
			if (state.inFlight) {
				ctx.ui.notify("Already generating a title.", "warning");
				return;
			}

			const excerpt = conversationExcerpt(ctx);
			if (excerpt.prompt === "") {
				ctx.ui.notify("Nothing to title yet — say something first.", "warning");
				return;
			}

			state.inFlight = true;
			try {
				const title = await generateTitle(ctx, {
					promptText: excerpt.prompt,
					replyText: excerpt.reply,
					modelOverride: process.env[MODEL_ENV],
				});

				if (!title) {
					ctx.ui.notify("Could not generate a title.", "warning");
					return;
				}

				pi.setSessionName(title);
				state.titledByMe = title;
				state.stoodDown = false;
				ctx.ui.notify(`Session titled: ${title}`, "info");
			} finally {
				state.inFlight = false;
			}
		},
	});
}

/** Title once, after the first settled turn, then never again on its own. */
async function settleTitling(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: TitlerState,
): Promise<void> {
	if (state.stoodDown || state.inFlight || state.titledByMe) {
		return;
	}

	if (pi.getSessionName()) {
		return;
	}

	const excerpt = conversationExcerpt(ctx);
	if (excerpt.prompt === "") {
		return;
	}

	state.inFlight = true;
	try {
		const title = await generateTitle(ctx, {
			promptText: excerpt.prompt,
			replyText: excerpt.reply,
			modelOverride: process.env[MODEL_ENV],
		});

		if (!title || pi.getSessionName()) {
			return;
		}

		pi.setSessionName(title);
		state.titledByMe = title;
	} finally {
		state.inFlight = false;
	}
}

/** The first user prompt and the first assistant reply, bounded in size. */
function conversationExcerpt(ctx: ExtensionContext): { prompt: string; reply?: string } {
	let prompt = "";
	let reply: string | undefined;

	for (const raw of ctx.sessionManager.getEntries()) {
		const entry = raw as {
			type?: string;
			message?: { role?: string; content?: unknown };
		};

		if (entry.type !== "message") {
			continue;
		}

		if (entry.message?.role === "user" && prompt === "") {
			prompt = blockText(entry.message.content).slice(0, PROMPT_MAX_CHARS);
		} else if (entry.message?.role === "assistant" && reply === undefined) {
			reply = blockText(entry.message.content).slice(0, REPLY_MAX_CHARS);
		}

		if (prompt !== "" && reply !== undefined) {
			break;
		}
	}

	return { prompt, reply };
}

function blockText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.filter((block) => (block as { type?: string }).type === "text")
			.map((block) => (block as { text?: string }).text ?? "")
			.join("\n");
	}

	return "";
}
