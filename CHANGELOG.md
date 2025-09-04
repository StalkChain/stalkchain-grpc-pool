# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2025-07-18

### Changed
- Stale connection detection now only considers actual transaction data, not ping/pong messages
  - This provides more accurate detection of unhealthy connections that might still be sending pings but not receiving transactions
  - The connection will now only be marked as fresh when actual transaction data is received

### Fixed
- Updated package name in README to use `@stalkchain/grpc-pool`
- Added proper import examples for both TypeScript/ES Modules and CommonJS

## [1.1.2] - 2025-09-04

### Added
- Per-connection unique `clientId` to fully support duplicate endpoint URLs
- `EndpointEvent` now includes `clientId` for precise per-connection monitoring
- `GrpcPool.getStatus()` now returns `{ clientId, endpoint, connected, timeSinceLastMessage? }`

### Changed
- Examples updated to log full endpoint URLs instead of short names
- `examples/pool-monitoring.ts` tracks connection states by `clientId`
- README event docs updated to include `clientId` and duplicate URL support

### Fixed
- Monitoring summary parsing no longer treats `client-#` as a delimiter; uses `::` safely
