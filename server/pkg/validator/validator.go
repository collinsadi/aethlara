package validator

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	nameRegex  = regexp.MustCompile(`^[a-zA-Z\s\-]+$`)
	otpRegex   = regexp.MustCompile(`^\d{6}$`)
)

func ValidateEmail(email string) bool {
	if len(email) > 255 {
		return false
	}
	return emailRegex.MatchString(email)
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func ValidateFullName(name string) bool {
	name = strings.TrimSpace(name)
	l := utf8.RuneCountInString(name)
	if l < 2 || l > 100 {
		return false
	}
	return nameRegex.MatchString(name)
}

func ValidateOTP(otp string) bool {
	return otpRegex.MatchString(otp)
}

func ValidateOTPType(t string) bool {
	return t == "signup" || t == "login"
}
