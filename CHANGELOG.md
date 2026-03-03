# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Logging support (experimental) via `enableLogging` configuration option

### Changed

- **BREAKING:** Replaced `url` with `collectorUrl` — signal paths (`/v1/traces`, `/v1/logs`) are now appended automatically, following the [OTLP exporter specification](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)
