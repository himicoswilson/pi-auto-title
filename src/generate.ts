// Title generation: pick a model, ask it once, sanitize what comes back.
// Model resolution is fail-closed: a PI_AUTO_TITLE_MODEL override that
// cannot be resolved or has no configured auth ends titling here, never
// quietly spending the session's own model instead.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	GENERATE_MAX_TOKENS,
	GENERATE_TIMEOUT_MS,
	languageName,
	maxLengthFromEnv,
	parseModelRef,
	sanitizeTitle,
} from "./policy.ts";

/**
 * The instruction the titling model works under. A named language pins
 * the title's language; null leaves it to follow the conversation.
 */
export function titleSystemPrompt(language: string | null): string {
	const inLanguage = language
		? `Write the title in ${language}.`
		: "Use the same language as the user's message.";

	return (
		"Name this chat session. Reply with ONLY a short title, at most " +
		`about 8 words long. ${inLanguage} ` +
		"No quotation marks, no trailing punctuation, no explanation."
	);
}

export interface GenerateInput {
	promptText: string;
	replyText?: string;
	modelOverride?: string;
	/** Raw language preference; normalized by languageName. */
	language?: string;
}

/**
 * Ask a model for a session title. Returns null when there is no model to
 * ask, the call fails or times out, or nothing title-worthy comes back.
 * Never throws.
 */
export async function generateTitle(
	ctx: ExtensionContext,
	input: GenerateInput,
): Promise<string | null> {
	const model = resolveTitleModel(ctx, input.modelOverride);
	if (!model) {
		return null;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

	try {
		const response = await ctx.modelRegistry.complete(
			model,
			{
				systemPrompt: titleSystemPrompt(languageName(input.language)),
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: titleUserMessage(input) }],
						timestamp: Date.now(),
					},
				],
			},
			{
				maxTokens: GENERATE_MAX_TOKENS,
				signal: controller.signal,
				sessionId: ctx.sessionManager.getSessionId(),
			},
		);

		const text = (response.content ?? [])
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n");

		return sanitizeTitle(text, maxLengthFromEnv(process.env.PI_AUTO_TITLE_MAX_LENGTH));
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function resolveTitleModel(
	ctx: ExtensionContext,
	modelOverride: string | undefined,
): ReturnType<ExtensionContext["modelRegistry"]["find"]> | null {
	const registry = ctx.modelRegistry;

	if (modelOverride) {
		const ref = parseModelRef(modelOverride);
		if (!ref) {
			return null;
		}

		const model = registry.find(ref.provider, ref.modelId);
		if (!model || !registry.hasConfiguredAuth(model)) {
			return null;
		}

		return model;
	}

	const model = ctx.model;
	if (!model || !registry.hasConfiguredAuth(model)) {
		return null;
	}

	return model;
}

function titleUserMessage(input: GenerateInput): string {
	let message = `Conversation to title:\n\nUser: ${input.promptText}`;
	if (input.replyText) {
		message += `\n\nAssistant: ${input.replyText}`;
	}

	return message;
}
