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
