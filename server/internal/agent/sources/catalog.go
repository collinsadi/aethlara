package sources

// Info describes a source for settings UIs.
type Info struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Kind        string `json:"kind"` // "ats" (company watchlist), "board" (keyword feed), "ai"
	Description string `json:"description"`
	Attribution bool   `json:"attribution"` // listings must link back and credit the source
}

// Catalog lists every discovery source in display order.
func Catalog() []Info {
	return []Info{
		{Greenhouse, "Greenhouse", "ats", "Company boards on Greenhouse from your watchlist.", false},
		{Lever, "Lever", "ats", "Company boards on Lever from your watchlist.", false},
		{Ashby, "Ashby", "ats", "Company boards on Ashby from your watchlist.", false},
		{Remotive, "Remotive", "board", "Remote jobs, searched by your target titles.", true},
		{RemoteOK, "Remote OK", "board", "Latest remote jobs, filtered by your titles and keywords.", true},
		{Himalayas, "Himalayas", "board", "Remote jobs, searched by your target titles.", false},
		{Jobicy, "Jobicy", "board", "Remote jobs, searched by your keywords.", true},
		{Arbeitnow, "Arbeitnow", "board", "European jobs (many in Germany), filtered by your titles.", false},
		{WebSearch, "Claude web search", "ai", "Claude searches the web for matching postings (Anthropic key required).", false},
	}
}

// DefaultEnabled reports whether a source is on for new profiles.
func DefaultEnabled(id string) bool {
	switch id {
	case Arbeitnow:
		return false // mostly German-language, on-site roles
	default:
		return true
	}
}

// New builds every fetch-based source keyed by ID. Web search is not here:
// it runs through the AI client.
func New(f *Fetcher) map[string]Source {
	all := []Source{
		NewGreenhouse(f), NewLever(f), NewAshby(f),
		NewRemotive(f), NewRemoteOK(f), NewHimalayas(f), NewJobicy(f), NewArbeitnow(f),
	}
	out := make(map[string]Source, len(all))
	for _, s := range all {
		out[s.ID()] = s
	}
	return out
}

// StarterWatchlist is a set of company boards verified to be live with open
// roles (Nov 2026). Users edit their own copy in agent settings.
func StarterWatchlist() []CompanyRef {
	return []CompanyRef{
		{ATSGreenhouse, "stripe", "Stripe"},
		{ATSGreenhouse, "airbnb", "Airbnb"},
		{ATSGreenhouse, "discord", "Discord"},
		{ATSGreenhouse, "figma", "Figma"},
		{ATSGreenhouse, "coinbase", "Coinbase"},
		{ATSGreenhouse, "robinhood", "Robinhood"},
		{ATSGreenhouse, "gitlab", "GitLab"},
		{ATSGreenhouse, "cloudflare", "Cloudflare"},
		{ATSGreenhouse, "datadog", "Datadog"},
		{ATSGreenhouse, "databricks", "Databricks"},
		{ATSGreenhouse, "anthropic", "Anthropic"},
		{ATSGreenhouse, "reddit", "Reddit"},
		{ATSGreenhouse, "brex", "Brex"},
		{ATSGreenhouse, "duolingo", "Duolingo"},
		{ATSLever, "spotify", "Spotify"},
		{ATSLever, "palantir", "Palantir"},
		{ATSAshby, "openai", "OpenAI"},
		{ATSAshby, "notion", "Notion"},
		{ATSAshby, "ramp", "Ramp"},
		{ATSAshby, "cursor", "Cursor"},
		{ATSAshby, "supabase", "Supabase"},
		{ATSAshby, "linear", "Linear"},
		{ATSAshby, "replit", "Replit"},
		{ATSAshby, "posthog", "PostHog"},
	}
}
