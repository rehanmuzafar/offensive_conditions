package validators

import (
	"reflect"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"
)

// Username: 3-32 chars, alphanumeric + underscore + hyphen. Must start with letter.
var usernameRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{2,31}$`)

// TOTP code: 6 digits, optionally with spaces or dashes (we'll strip these in service layer).
var totpCodeRegex = regexp.MustCompile(`^[\d\s\-]{6,9}$`)

// Backup code: 10 alphanumeric chars.
var backupCodeRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{10}$`)

// Register hooks our custom validators with Gin's default validator engine.
func Register() error {
	v, ok := binding.Validator.Engine().(*validator.Validate)
	if !ok {
		return nil
	}

	// Use JSON tag names in error messages
	v.RegisterTagNameFunc(func(fld reflect.StructField) string {
		name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
		if name == "-" {
			return ""
		}
		return name
	})

	if err := v.RegisterValidation("username", validateUsername); err != nil {
		return err
	}
	if err := v.RegisterValidation("totp_code", validateTOTP); err != nil {
		return err
	}
	if err := v.RegisterValidation("backup_code", validateBackupCode); err != nil {
		return err
	}
	return nil
}

func validateUsername(fl validator.FieldLevel) bool {
	return usernameRegex.MatchString(fl.Field().String())
}

func validateTOTP(fl validator.FieldLevel) bool {
	return totpCodeRegex.MatchString(fl.Field().String())
}

func validateBackupCode(fl validator.FieldLevel) bool {
	return backupCodeRegex.MatchString(fl.Field().String())
}

// FormatErrors converts validator errors into a friendly map of field -> message.
func FormatErrors(err error) map[string]string {
	out := make(map[string]string)
	ve, ok := err.(validator.ValidationErrors)
	if !ok {
		out["_error"] = err.Error()
		return out
	}
	for _, fe := range ve {
		out[fe.Field()] = humanizeError(fe)
	}
	return out
}

func humanizeError(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "is required"
	case "email":
		return "must be a valid email address"
	case "min":
		return "must be at least " + fe.Param() + " characters"
	case "max":
		return "must be at most " + fe.Param() + " characters"
	case "username":
		return "must be 3-32 chars, alphanumeric + _ -, starting with a letter"
	case "totp_code":
		return "must be a 6-digit TOTP code"
	case "backup_code":
		return "must be a 10-character backup code"
	case "uuid":
		return "must be a valid UUID"
	case "oneof":
		return "must be one of: " + fe.Param()
	default:
		return "is invalid (" + fe.Tag() + ")"
	}
}
