// SPDX-License-Identifier: AGPL-3.0-only
// Quantum configuration/call adapter. Native Logrus owns formatting, JSON,
// colors and synchronized output; this package only selects configured sinks.
package logger

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

type JsonConfig struct {
	Levels         string `json:"levels"`
	ApiLevels      string `json:"apiLevels"`
	Output         string `json:"output"`
	NoColors       bool   `json:"noColors"`
	Json           bool   `json:"json"`
	Structured     bool   `json:"structured"`
	Utc            bool   `json:"utc"`
	ApiPathExclude string `json:"apiPathExclude"`
}

type sink struct {
	logger          *logrus.Logger
	levels, api     map[logrus.Level]bool
	exclude         *regexp.Regexp
	utc, structured bool
}

var configured struct {
	sync.RWMutex
	sinks []sink
}

var exitLogger = logrus.New()

func levelSet(value string) (map[logrus.Level]bool, error) {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '|' || r == ',' || r == ' ' })
	if len(parts) == 0 {
		return map[logrus.Level]bool{logrus.InfoLevel: true, logrus.WarnLevel: true, logrus.ErrorLevel: true}, nil
	}
	levels := make(map[logrus.Level]bool)
	disabled := false
	for _, part := range parts {
		switch strings.ToUpper(part) {
		case "DISABLED":
			disabled = true
		case "API": // Accepted legacy token; API calls use their HTTP severity.
		default:
			level, err := logrus.ParseLevel(strings.ToLower(part))
			if err != nil || level == logrus.TraceLevel || level == logrus.PanicLevel {
				return nil, fmt.Errorf("invalid log level: %s", part)
			}
			levels[level] = true
		}
	}
	if disabled {
		clear(levels)
	}
	return levels, nil
}

func EnableCompatibilityMode(config JsonConfig) error {
	levels, err := levelSet(config.Levels)
	if err != nil {
		return err
	}
	api, err := levelSet(config.ApiLevels)
	if err != nil {
		return err
	}
	var exclude *regexp.Regexp
	if config.ApiPathExclude != "" {
		exclude, err = regexp.Compile(config.ApiPathExclude)
		if err != nil {
			return fmt.Errorf("invalid API path filter: %w", err)
		}
	}
	native := logrus.New()
	native.SetLevel(logrus.DebugLevel)
	native.SetReportCaller(levels[logrus.DebugLevel])
	prettyCaller := func(frame *runtime.Frame) (string, string) {
		return "", fmt.Sprintf("%s:%d", filepath.Base(frame.File), frame.Line)
	}
	if config.Json {
		native.SetFormatter(&logrus.JSONFormatter{CallerPrettyfier: prettyCaller})
	} else {
		native.SetFormatter(&logrus.TextFormatter{ForceColors: !config.NoColors, DisableColors: config.NoColors,
			FullTimestamp: true, TimestampFormat: "2006/01/02 15:04:05", PadLevelText: true, CallerPrettyfier: prettyCaller})
	}
	if config.Output == "" || strings.EqualFold(config.Output, "stdout") {
		native.SetOutput(os.Stdout)
	} else {
		file, err := os.OpenFile(config.Output, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
		if err != nil {
			return err
		}
		native.SetOutput(file)
	}
	configured.Lock()
	configured.sinks = append(configured.sinks, sink{native, levels, api, exclude, config.Utc, config.Json || config.Structured})
	configured.Unlock()
	return nil
}

func caller() *runtime.Frame {
	_, adapterFile, _, _ := runtime.Caller(0)
	var pcs [12]uintptr
	frames := runtime.CallersFrames(pcs[:runtime.Callers(2, pcs[:])])
	for {
		frame, more := frames.Next()
		if frame.File != adapterFile {
			return &frame
		}
		if !more {
			return nil
		}
	}
}

func write(level logrus.Level, message string, api bool, requestPath string) {
	configured.RLock()
	defer configured.RUnlock()
	if len(configured.sinks) == 0 {
		log.Printf("[%s] %s", strings.ToUpper(level.String()), message)
		return
	}
	var source *runtime.Frame
	for _, output := range configured.sinks {
		if api {
			if !output.api[level] || (requestPath != "" && output.exclude != nil && output.exclude.MatchString(requestPath)) {
				continue
			}
		} else if level != logrus.FatalLevel && !output.levels[level] {
			continue
		}
		now := time.Now()
		if output.utc {
			now = now.UTC()
		}
		entry := output.logger.WithTime(now)
		if output.structured && requestPath != "" {
			entry = entry.WithField("request_path", requestPath)
		}
		if output.levels[logrus.DebugLevel] {
			if source == nil {
				source = caller()
			}
			entry.Caller = source
		}
		entry.Log(level, message)
	}
}

func sprint(args ...any) string { return strings.TrimSuffix(fmt.Sprintln(args...), "\n") }
func Debug(args ...any)         { write(logrus.DebugLevel, sprint(args...), false, "") }
func Info(args ...any)          { write(logrus.InfoLevel, sprint(args...), false, "") }
func Warning(args ...any)       { write(logrus.WarnLevel, sprint(args...), false, "") }
func Error(args ...any)         { write(logrus.ErrorLevel, sprint(args...), false, "") }
func Debugf(format string, args ...any) {
	write(logrus.DebugLevel, fmt.Sprintf(format, args...), false, "")
}
func Infof(format string, args ...any) {
	write(logrus.InfoLevel, fmt.Sprintf(format, args...), false, "")
}
func Warningf(format string, args ...any) {
	write(logrus.WarnLevel, fmt.Sprintf(format, args...), false, "")
}
func Errorf(format string, args ...any) {
	write(logrus.ErrorLevel, fmt.Sprintf(format, args...), false, "")
}
func Fatal(args ...any) {
	write(logrus.FatalLevel, sprint(args...), false, "")
	exitLogger.Exit(1)
}
func Fatalf(format string, args ...any) {
	write(logrus.FatalLevel, fmt.Sprintf(format, args...), false, "")
	exitLogger.Exit(1)
}
func Api(status int, args ...any) { ApiPath(status, "", args...) }
func ApiPath(status int, requestPath string, args ...any) {
	level := logrus.InfoLevel
	if status >= 500 {
		level = logrus.ErrorLevel
	} else if status > 304 {
		level = logrus.WarnLevel
	}
	write(level, sprint(args...), true, requestPath)
}
