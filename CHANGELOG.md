# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.1.2] - 2026-04-17

### Changed

- Updated OpenTelemetry dependencies: SDK 2.6.0 → 2.6.1, exporters/logs 0.213.0 → 0.214.0
- Bumped `@opentelemetry/api` peer dependency range to `^1.9.1`

## [2.1.1] - 2026-03-06

### Fixed

- Provider: register `W3CTraceContextPropagator` and `StackContextManager` — without these, trace context propagation via `propagateToUrls` was non-functional
- Fetch plugin: use own span context for `traceparent` injection instead of requiring an externally-set active span
- Fetch plugin: auto-ignore OTLP collector signal paths (`/v1/traces`, `/v1/logs`, `/v1/metrics`) to prevent infinite export feedback loop

### Changed

- Updated README with `propagateToUrls` distributed tracing documentation
- Clarified that TanStack Query plugin should be used alongside the fetch plugin for distributed tracing

## [2.1.0] - 2026-03-05

### Added

- TanStack Query plugin: `ignoreQueries` option to filter queries from tracing by matching against the query hash string
- TanStack Query plugin: `ignoreMutations` option to filter mutations from tracing by matching against the mutation key
- TanStack Router plugin: `ignoreRoutes` option to filter navigations from tracing by matching against the target pathname
- Error handler plugin: `ignoreErrors` option to filter errors and unhandled rejections from tracing by matching against the error message
- Provider: `serviceVersion` option to set service version resource attribute
- Provider: `environment` option to set deployment environment name resource attribute
- Provider: `sampleRate` option for trace sampling (0-1)

## [2.0.2] - 2026-03-05

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
