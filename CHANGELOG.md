# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.1] - 2026-03-05

### Fixed

- Fetch plugin: use `WeakMap` for XHR metadata instead of global type augmentation
- Fetch plugin: handle XHR `timeout` and `abort` events to prevent dangling spans
- Fetch plugin: avoid injecting trace headers when URL does not match `propagateToUrls`
- TanStack Query plugin: truncate long query/mutation keys in span names and attributes

### Changed

- Updated OpenTelemetry dependencies to latest versions (sdk 2.6.0, exporters/logs 0.213.0)

## [2.0.0] - 2026-03-03

### Added

- Logging support (experimental) via `enableLogging` configuration option
- Error handler plugin for automatic `window.onerror` and unhandled rejection tracking
- SSR trace context propagation via `<meta name="traceparent">` in document-load plugin

### Changed

- **BREAKING:** Replaced `url` with `collectorUrl` — signal paths (`/v1/traces`, `/v1/logs`) are now appended automatically, following the [OTLP exporter specification](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)
