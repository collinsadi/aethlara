package ai

import "strings"

// Capability tables for Anthropic model IDs. Users may configure any model,
// including older ones, so request features are only attached where the
// model accepts them (sending e.g. effort to Haiku 4.5 returns a 400).

func hasAnyPrefix(model string, prefixes ...string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(model, p) {
			return true
		}
	}
	return false
}

// supportsEffort reports whether output_config.effort is accepted.
func supportsEffort(model string) bool {
	return hasAnyPrefix(model,
		"claude-fable-", "claude-mythos-",
		"claude-opus-5", "claude-sonnet-5", "claude-haiku-5",
		"claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
		"claude-sonnet-4-6",
	)
}

// supportsStructuredOutputs reports whether output_config.format is accepted.
func supportsStructuredOutputs(model string) bool {
	return hasAnyPrefix(model,
		"claude-fable-5", "claude-mythos-5",
		"claude-opus-5", "claude-sonnet-5", "claude-haiku-5",
		"claude-opus-4-8", "claude-haiku-4-5", "claude-opus-4-5", "claude-opus-4-1",
	)
}

// supportsDefaultFallbacks reports whether the server-side refusal fallback
// in its "default" form may be sent with this model.
func supportsDefaultFallbacks(model string) bool {
	switch model {
	case "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5":
		return true
	}
	return false
}

// supportsDynamicWebSearch reports whether web_search_20260209 (dynamic
// filtering) is available; older models use web_search_20250305.
func supportsDynamicWebSearch(model string) bool {
	return hasAnyPrefix(model,
		"claude-opus-5", "claude-sonnet-5",
		"claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
	)
}

// SuggestedModels lists models offered in the settings UI per provider. Any
// other model ID the provider accepts can still be entered manually.
func SuggestedModels(p Provider) []string {
	if p == ProviderAnthropic {
		return []string{
			"claude-opus-5-5",
			"claude-sonnet-5-5",
			"claude-haiku-5-5",
			"claude-fable-5-1",
		}
	}
	return []string{
		"anthropic/claude-opus-5.5",
		"anthropic/claude-sonnet-5.5",
		"anthropic/claude-haiku-5.5",
		"anthropic/claude-fable-5.1",
	}
}
