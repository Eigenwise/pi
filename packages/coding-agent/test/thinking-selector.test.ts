import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ThinkingSelectorComponent } from "../src/modes/interactive/components/thinking-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function testModel(id: string, overrides: Partial<Model<"openai-responses">> = {}): Model<"openai-responses"> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider: "test",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
		...overrides,
	};
}

// Named efforts whose provider values match Pi's level IDs.
const effortModel = testModel("effort", {
	thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
});
// Pi's minimal level is sent as the provider's low value.
const remappedModel = testModel("remapped", {
	thinkingLevelMap: { minimal: "low", xhigh: "xhigh" },
});
// Reasoning can only be switched off or on.
const switchModel = testModel("switch", {
	thinkingLevelMap: { minimal: null, low: null, medium: null, high: "enabled" },
});
const customModel = testModel("custom");

function createSelector(
	model: Model<Api> | undefined,
	options: {
		current?: ThinkingLevel;
		defaultLevel?: ThinkingLevel;
		onSelect?: (level: ThinkingLevel) => void;
	} = {},
): ThinkingSelectorComponent {
	const levels = (
		model ? getSupportedThinkingLevels(model) : ["off", "minimal", "low", "medium", "high"]
	) as ThinkingLevel[];
	return new ThinkingSelectorComponent(
		options.current ?? "off",
		levels,
		options.onSelect ?? (() => {}),
		() => {},
		undefined,
		options.defaultLevel,
		model,
	);
}

/** Rendered rows keyed by level ID; each row starts with the selection cursor and current-level mark. */
function levelRows(selector: ThinkingSelectorComponent): Map<string, string> {
	const rows = new Map<string, string>();
	for (const line of selector.getSelectList().render(120)) {
		const row = stripAnsi(line);
		const level = row.slice(4).split(/\s/)[0];
		if (level) rows.set(level, row.slice(4 + level.length).trim());
	}
	return rows;
}

describe("thinking selector", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("keeps the current thinking level marked while browsing", () => {
		const selector = new ThinkingSelectorComponent(
			"medium",
			["medium", "high"],
			() => {},
			() => {},
		);
		const getLevelRow = (level: string): string | undefined =>
			selector
				.getSelectList()
				.render(80)
				.map((line) => stripAnsi(line))
				.find((line) => line.includes(level));

		expect(selector.getSelectList().getSelectedItem()?.label).toBe("✓ medium");
		expect(getLevelRow("medium")?.startsWith("→ ✓ medium")).toBe(true);
		selector.handleInput("\x1b[B");
		expect(getLevelRow("medium")?.startsWith("  ✓ medium")).toBe(true);
		expect(getLevelRow("high")?.startsWith("→   high")).toBe(true);
	});

	it("uses the configured save binding", () => {
		setKeybindings(new KeybindingsManager({ "app.thinking.save": "ctrl+r" }));
		const saveDefault = vi.fn();
		const selector = new ThinkingSelectorComponent(
			"medium",
			["medium", "high"],
			() => {},
			() => {},
			saveDefault,
		);

		expect(stripAnsi(selector.render(80).join("\n"))).toContain("Ctrl+R to set as default");
		selector.handleInput("\x13");
		expect(saveDefault).not.toHaveBeenCalled();
		selector.handleInput("\x12");
		expect(saveDefault).toHaveBeenCalledWith("medium");
	});

	it("describes named effort levels without universal token estimates", () => {
		const rows = levelRows(createSelector(effortModel));

		expect([...rows.keys()]).toEqual(["off", "low", "medium", "high", "xhigh"]);
		expect(rows.get("off")).toBe("No reasoning · provider value: none");
		expect(rows.get("low")).toBe("Low reasoning");
		expect(rows.get("medium")).toBe("Medium reasoning");
		expect(rows.get("high")).toBe("High reasoning");
		expect(rows.get("xhigh")).toBe("Extra-high reasoning");
		expect([...rows.values()].join("\n")).not.toMatch(/tokens|~\d/);
	});

	it("shows a configured provider value that differs from the level ID", () => {
		const rows = levelRows(createSelector(remappedModel));

		expect(rows.get("minimal")).toBe("Minimal reasoning · provider value: low");
		expect(rows.get("low")).toBe("Low reasoning");
	});

	it("describes an off/on-only model as reasoning enabled", () => {
		const rows = levelRows(createSelector(switchModel));

		expect([...rows.keys()]).toEqual(["off", "high"]);
		expect(rows.get("off")).toBe("No reasoning");
		expect(rows.get("high")).toBe("Reasoning enabled · provider value: enabled");
	});

	it("uses qualitative descriptions for custom models and unknown models", () => {
		for (const model of [customModel, undefined]) {
			const rows = levelRows(createSelector(model));
			expect(rows.get("minimal")).toBe("Minimal reasoning");
			expect(rows.get("medium")).toBe("Medium reasoning");
			expect(rows.get("high")).toBe("High reasoning");
		}
	});

	it("marks current and default levels and selects native level IDs", () => {
		const onSelect = vi.fn();
		const selector = createSelector(remappedModel, { current: "low", defaultLevel: "minimal", onSelect });
		const rows = levelRows(selector);

		expect(rows.get("minimal")).toBe("Minimal reasoning · provider value: low · default");
		expect(selector.getSelectList().getSelectedItem()?.label).toBe("✓ low");
		selector.handleInput("\x1b[A");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith("minimal");
	});
});
