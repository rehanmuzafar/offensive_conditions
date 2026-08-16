package email

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"html/template"
	"net/smtp"
	"path/filepath"
	"time"
)

// Sender abstracts email delivery. Tests use a NoopSender.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// Message is a transactional email.
type Message struct {
	To       string
	ToName   string
	Subject  string
	Template string         // Template file name e.g. "verify_email.html"
	Data     map[string]any // Template variables
}

// Config for the SMTP sender.
type Config struct {
	Host         string
	Port         int
	User         string
	Password     string
	From         string
	FromName     string
	UseTLS       bool
	TemplatesDir string
	Timeout      time.Duration
}

// SMTPSender sends email via an external SMTP relay (SendGrid, AWS SES, Mailgun, etc.)
type SMTPSender struct {
	cfg       Config
	templates map[string]*template.Template
}

// NewSMTPSender pre-loads templates.
func NewSMTPSender(cfg Config) (*SMTPSender, error) {
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}
	tmpls, err := loadTemplates(cfg.TemplatesDir)
	if err != nil {
		return nil, fmt.Errorf("load templates: %w", err)
	}
	return &SMTPSender{cfg: cfg, templates: tmpls}, nil
}

func loadTemplates(dir string) (map[string]*template.Template, error) {
	out := make(map[string]*template.Template)
	files, err := filepath.Glob(filepath.Join(dir, "*.html"))
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		t, err := template.ParseFiles(f)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", f, err)
		}
		out[filepath.Base(f)] = t
	}
	return out, nil
}

func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	tmpl, ok := s.templates[msg.Template]
	if !ok {
		return fmt.Errorf("template not found: %s", msg.Template)
	}

	var body bytes.Buffer
	if err := tmpl.Execute(&body, msg.Data); err != nil {
		return fmt.Errorf("render template: %w", err)
	}

	from := fmt.Sprintf("%s <%s>", s.cfg.FromName, s.cfg.From)
	to := msg.To
	if msg.ToName != "" {
		to = fmt.Sprintf("%s <%s>", msg.ToName, msg.To)
	}

	headers := map[string]string{
		"From":         from,
		"To":           to,
		"Subject":      msg.Subject,
		"MIME-version": "1.0",
		"Content-Type": `text/html; charset="UTF-8"`,
	}

	var raw bytes.Buffer
	for k, v := range headers {
		fmt.Fprintf(&raw, "%s: %s\r\n", k, v)
	}
	raw.WriteString("\r\n")
	raw.Write(body.Bytes())

	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)

	// Only authenticate when credentials are configured — mailpit and other
	// local dev servers don't support AUTH and reject it if attempted.
	var auth smtp.Auth
	if s.cfg.User != "" && s.cfg.Password != "" {
		auth = smtp.PlainAuth("", s.cfg.User, s.cfg.Password, s.cfg.Host)
	}

	if s.cfg.UseTLS {
		return sendTLS(addr, auth, s.cfg.Host, s.cfg.From, []string{msg.To}, raw.Bytes())
	}
	return smtp.SendMail(addr, auth, s.cfg.From, []string{msg.To}, raw.Bytes())
}

func sendTLS(addr string, auth smtp.Auth, host, from string, to []string, msg []byte) error {
	tlsCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	conn, err := tls.Dial("tcp", addr, tlsCfg)
	if err != nil {
		return fmt.Errorf("tls dial: %w", err)
	}
	defer conn.Close()

	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close()

	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("auth: %w", err)
		}
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}
	for _, rcpt := range to {
		if err := c.Rcpt(rcpt); err != nil {
			return fmt.Errorf("rcpt: %w", err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("close: %w", err)
	}
	return c.Quit()
}

// NoopSender is a test/dev sender that logs but doesn't deliver.
type NoopSender struct {
	Sent []Message
}

func (n *NoopSender) Send(_ context.Context, msg Message) error {
	n.Sent = append(n.Sent, msg)
	return nil
}
