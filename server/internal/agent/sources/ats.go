package sources

import (
	"net/url"
	"strings"
)

// ATS identifiers returned by DetectATS.
const (
	ATSGreenhouse      = "greenhouse"
	ATSLever           = "lever"
	ATSAshby           = "ashby"
	ATSWorkable        = "workable"
	ATSSmartRecruiters = "smartrecruiters"
	ATSWorkday         = "workday"
	ATSBambooHR        = "bamboohr"
	ATSRecruitee       = "recruitee"
	ATSBreezy          = "breezy"
	ATSJazzHR          = "jazzhr"
	ATSTeamtailor      = "teamtailor"
	ATSPersonio        = "personio"
	ATSICIMS           = "icims"
	ATSTaleo           = "taleo"
	ATSUnknown         = ""
)

var atsHosts = []struct {
	suffix string
	ats    string
}{
	{"greenhouse.io", ATSGreenhouse},
	{"lever.co", ATSLever},
	{"ashbyhq.com", ATSAshby},
	{"workable.com", ATSWorkable},
	{"smartrecruiters.com", ATSSmartRecruiters},
	{"myworkdayjobs.com", ATSWorkday},
	{"myworkdaysite.com", ATSWorkday},
	{"bamboohr.com", ATSBambooHR},
	{"recruitee.com", ATSRecruitee},
	{"breezy.hr", ATSBreezy},
	{"applytojob.com", ATSJazzHR},
	{"teamtailor.com", ATSTeamtailor},
	{"jobs.personio.com", ATSPersonio},
	{"jobs.personio.de", ATSPersonio},
	{"icims.com", ATSICIMS},
	{"taleo.net", ATSTaleo},
}

// DetectATS identifies the applicant tracking system behind an application
// URL. Company career pages that embed Greenhouse are recognised by the
// gh_jid query parameter.
func DetectATS(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return ATSUnknown
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range atsHosts {
		if host == h.suffix || strings.HasSuffix(host, "."+h.suffix) {
			return h.ats
		}
	}
	if u.Query().Get("gh_jid") != "" {
		return ATSGreenhouse
	}
	return ATSUnknown
}

// GreenhouseEmbedURL is the standalone application form for a Greenhouse
// job. It renders for every board — including companies whose hosted board
// redirects to a custom careers site — which makes it the most reliable page
// for the extension to fill.
func GreenhouseEmbedURL(boardSlug, jobID string) string {
	return "https://job-boards.greenhouse.io/embed/job_app?for=" + url.QueryEscape(boardSlug) +
		"&token=" + url.QueryEscape(jobID)
}

// AutoApplySupported reports whether the extension has a dedicated form
// adapter for the ATS (others fall back to generic form filling).
func AutoApplySupported(ats string) bool {
	switch ats {
	case ATSGreenhouse, ATSLever, ATSAshby:
		return true
	}
	return false
}

// NormalizeApplyURL points known ATS posting pages at their application
// form: Greenhouse hosted pages become the embeddable form, Lever postings
// get /apply and Ashby postings /application. Other URLs are returned as is.
func NormalizeApplyURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return raw
	}
	host := strings.ToLower(u.Hostname())
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	switch {
	case host == "boards.greenhouse.io" || host == "job-boards.greenhouse.io":
		if len(parts) >= 3 && parts[1] == "jobs" && parts[0] != "embed" {
			return GreenhouseEmbedURL(parts[0], parts[2])
		}
	case host == "jobs.lever.co" || host == "jobs.eu.lever.co":
		if len(parts) == 2 {
			return u.Scheme + "://" + u.Host + "/" + parts[0] + "/" + parts[1] + "/apply"
		}
	case host == "jobs.ashbyhq.com":
		if len(parts) == 2 {
			return u.Scheme + "://" + u.Host + "/" + parts[0] + "/" + parts[1] + "/application"
		}
	}
	return raw
}
