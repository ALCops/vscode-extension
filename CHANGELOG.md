# Change Log

All notable changes to the ALCops extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] - 2026-02-21

### Performance
- Bundled extension with esbuild, reducing the VSIX to a single `dist/extension.js` (minified)
- Added `.vscodeignore` rules to exclude `node_modules`, `out`, dev tooling, and source maps from the published package


## [1.2.0] - 2026-02-21

### Changed
- Refactored code analyzers manager and downloader for improved functionality
- Removed `isCommon` property from `CodeAnalyzerInfo` interface
- Added `refresh` method to `CodeAnalyzersManager` to reload analyzers from the manifest
- Streamlined version querying logic in `queryLatestVersion` function
- Simplified file locking checks and user prompts in `handleLockedFiles`
- Enhanced error handling with a new `formatError` utility function
- Added `launchNewVSCodeWindow` function to handle opening new VS Code instances across different environments
- Cleaned up unused functions and improved overall code readability
- Added Dependabot configuration and committed lockfile
- Fixed CI build workflow and updated release artifact type from .nupkg to .vsix

## [1.1.1] - 2026-01-25

### Fixed
- Added installation mutex to prevent race conditions during concurrent installation attempts
- Fixed status bar count to include non-standard code analyzers (e.g., third-party analyzers with `${analyzerFolder}` prefix)
- Fixed GitHub repository link in README.md

### Changed
- Refactored auto-updater to streamline installation recovery and update checks
- Enhanced version manager with reinstallation logic

## [1.1.0] - 2025-10-17

### Added
- Add Code Analyzers Manager and Status Bar integration

## [1.0.1] - 2025-10-17

### Added
- Initial release of ALCops extension