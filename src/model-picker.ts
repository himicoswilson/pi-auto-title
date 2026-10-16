// A model picker in the style of Pi's own /model page: a bordered
// overlay with a search line on top and a filterable list under it,
// assembled from the same pi-tui components the built-in pages use.
// Pi does not offer its selector to extensions, so this is the closest
// honest relative: same parts, same keys, no copied insides.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	SelectList,
	Spacer,
	Text,
	type Component,
	type SelectItem,
} from "@earendil-works/pi-tui";

/** The slice of Pi's theme this page styles itself with. */
interface ThemeLike {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

/** The slice of the keybindings manager this page routes keys with. */
interface KeybindingsLike {
	matches(data: string, keybinding: string): boolean;
}

/** A full-width rule in a fixed color; the page's top and bottom edge. */
class BorderLine implements Component {
	private readonly colorize: (text: string) => string;

	constructor(colorize: (text: string) => string) {
		this.colorize = colorize;
	}

	render(width: number): string[] {
		return [this.colorize("─".repeat(Math.max(width, 0)))];
	}

	invalidate(): void {}
}

/** The value of the "use the session model" entry. */
export const SESSION_MODEL_VALUE = "__session__";

/** The slice of a model the picker shows. */
export interface ModelRecord {
	provider: string;
	id: string;
	contextWindow?: number;
	reasoning?: boolean;
}

/**
 * The picker's entries: the session-model default first, then every
 * usable model sorted by provider and id. The entry the preferences
 * currently resolve to is marked "current" in its description.
 */
export function buildModelItems(
	models: ModelRecord[],
	effectiveRef: string | undefined,
): SelectItem[] {
	const items: SelectItem[] = [
		{
			value: SESSION_MODEL_VALUE,
			label: "Session model",
			description:
				"Use the model this session runs on" +
				(effectiveRef ? "" : " · current"),
		},
	];

	const sorted = [...models].sort(
		(a, b) =>
			a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
	);

	for (const model of sorted) {
		const ref = `${model.provider}/${model.id}`;
		const notes: string[] = [];
		if (model.contextWindow) {
			notes.push(formatContext(model.contextWindow));
		}

		if (model.reasoning) {
			notes.push("reasoning");
		}

		if (ref === effectiveRef) {
			notes.push("current");
		}

		items.push({
			value: ref,
			label: ref,
			description: notes.join(" · ") || undefined,
		});
	}

	return items;
}

function formatContext(size: number): string {
	if (size >= 1_000_000) {
		const millions = size / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M context`;
	}

	return `${Math.round(size / 1_000)}k context`;
}

/**
 * Ask for a model. Resolves to the picked entry's value, or undefined
 * when the user cancelled. Falls back to the plain select dialog when
 * the custom overlay cannot be shown.
 */
export async function pickModel(
	ctx: ExtensionContext,
	items: SelectItem[],
): Promise<string | undefined> {
	try {
		const picked = await ctx.ui.custom<string | null>(
			(_tui, theme, keybindings, done) =>
				new ModelPicker(theme, keybindings, items, done),
		);
		return picked ?? undefined;
	} catch {
		const label = await ctx.ui.select(
			"Title model",
			items.map((item) => item.label),
		);
		return items.find((item) => item.label === label)?.value;
	}
}

/**
 * The overlay itself: search input above the list. Navigation and
 * confirmation keys go to the list; everything else goes to the search
 * input, whose value filters the list.
 */
class ModelPicker implements Component {
	private readonly container = new Container();
	private readonly search = new Input();
	private readonly list: SelectList;
	private readonly keybindings: KeybindingsLike;
	private filter = "";

	constructor(
		theme: ThemeLike,
		keybindings: KeybindingsLike,
		items: SelectItem[],
		done: (value: string | null) => void,
	) {
		this.keybindings = keybindings;
		this.list = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.list.onSelect = (item) => done(item.value);
		this.list.onCancel = () => done(null);

		this.container.addChild(new BorderLine((str) => theme.fg("accent", str)));
		this.container.addChild(new Text(theme.fg("accent", theme.bold("Title model")), 0, 0));
		this.container.addChild(this.search);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.list);
		this.container.addChild(
			new Text(
				theme.fg("dim", "type to filter · ↑↓ navigate · enter select · esc cancel"),
				0,
				0,
			),
		);
		this.container.addChild(new BorderLine((str) => theme.fg("accent", str)));
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate();
	}

	handleInput(data: string): void {
		if (
			this.keybindings.matches(data, "tui.select.up") ||
			this.keybindings.matches(data, "tui.select.down") ||
			this.keybindings.matches(data, "tui.select.confirm") ||
			this.keybindings.matches(data, "tui.select.cancel")
		) {
			this.list.handleInput(data);
			return;
		}

		this.search.handleInput(data);
		const value = this.search.getValue();
		if (value !== this.filter) {
			this.filter = value;
			this.list.setFilter(value);
		}
	}
}
