// Wiring only: hook Pi's extension events, keep the titling state machine,
// and register the /retitle command. Generation itself lives in
// generate.ts; the rules that keep it out of the user's way live below.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPath, loadPreferences, savePreferences } from "./config.ts";
import { generateTitle } from "./generate.ts";
import {
	isEnabled,
	LANGUAGE_CHOICES,
	languageName,
	parseModelRef,
	PROMPT_MAX_CHARS,
	REPLY_MAX_CHARS,
	resolvePreferences,
	type TitlePreferences,
} from "./policy.ts";

const ENABLE_ENV = "PI_AUTO_TITLE";
const MODEL_ENV = "PI_AUTO_TITLE_MODEL";
const LANGUAGE_ENV = "PI_AUTO_TITLE_LANGUAGE";

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
					...preferenceInput(),
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

	pi.registerCommand("title-model", {
		description: "Show or set the model titles are generated with",
		handler: async (args, ctx) => {
			const written = args.trim();

			if (written === "clear") {
				savePreferences({ model: undefined });
				ctx.ui.notify("Title model cleared; the session model is used.", "info");
				return;
			}

			if (written !== "") {
				const ref = parseModelRef(written);
				const model = ref ? ctx.modelRegistry.find(ref.provider, ref.modelId) : undefined;
				if (!ref || !model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
					ctx.ui.notify(`Not a usable model: ${written}`, "warning");
					return;
				}

				savePreferences({ model: written });
				ctx.ui.notify(`Title model set to ${written} (${configPath()}).`, "info");
				return;
			}

			const usable = [...new Set(
				ctx.modelRegistry
					.getAll()
					.filter((model) => ctx.modelRegistry.hasConfiguredAuth(model))
					.map((model) => `${model.provider}/${model.id}`),
			)].sort();

			const picked = await ctx.ui.select("Title model", [
				"Use the session model (default)",
				...usable,
			]);

			if (picked === undefined) {
				ctx.ui.notify(modelStatus(), "info");
				return;
			}

			savePreferences({
				model: picked === "Use the session model (default)" ? undefined : picked,
			});
			ctx.ui.notify(`Title model: ${picked} (${configPath()}).`, "info");
		},
	});

	pi.registerCommand("title-language", {
		description: "Show or set the language titles are generated in",
		handler: async (args, ctx) => {
			const written = args.trim();

			if (written === "clear" || written.toLowerCase() === "auto") {
				savePreferences({ language: undefined });
				ctx.ui.notify("Title language cleared; titles match the conversation.", "info");
				return;
			}

			if (written !== "") {
				savePreferences({ language: written });
				ctx.ui.notify(
					`Title language set to ${languageName(written) ?? written} (${configPath()}).`,
					"info",
				);
				return;
			}

			const auto = "Auto (match the conversation)";
			const picked = await ctx.ui.select("Title language", [
				auto,
				...LANGUAGE_CHOICES.map((choice) => choice.label),
			]);

			if (picked === undefined) {
				ctx.ui.notify(languageStatus(), "info");
				return;
			}

			const choice = LANGUAGE_CHOICES.find((entry) => entry.label === picked);
			savePreferences({ language: picked === auto ? undefined : choice?.code });
			ctx.ui.notify(`Title language: ${picked} (${configPath()}).`, "info");
		},
	});
}

/** The preferences generation runs under: environment over config file. */
function preferenceInput(): { modelOverride?: string; language?: string } {
	const prefs = resolvePreferences(
		{ model: process.env[MODEL_ENV], language: process.env[LANGUAGE_ENV] },
		loadPreferences(),
	);

	return { modelOverride: prefs.model, language: prefs.language };
}

/** Which layer states a preference: the environment, the file, or neither. */
function preferenceSource(key: keyof TitlePreferences): string {
	const env = key === "model" ? process.env[MODEL_ENV] : process.env[LANGUAGE_ENV];
	if (env?.trim()) {
		return "environment";
	}

	return loadPreferences()[key] ? "config file" : "default";
}

function modelStatus(): string {
	const prefs = resolvePreferences(
		{ model: process.env[MODEL_ENV] },
		loadPreferences(),
	);

	return prefs.model
		? `Title model: ${prefs.model} (from ${preferenceSource("model")})`
		: "Title model: the session model (default)";
}

function languageStatus(): string {
	const prefs = resolvePreferences(
		{ language: process.env[LANGUAGE_ENV] },
		loadPreferences(),
	);
	const name = languageName(prefs.language);

	return name
		? `Title language: ${name} (from ${preferenceSource("language")})`
		: "Title language: auto (matches the conversation)";
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
			...preferenceInput(),
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
