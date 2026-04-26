# Change Log

All notable changes to the ALCops extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-04-26

### Changed
- Change NuGet download User-Agent from `ALCops-VSCode/{version}` to `NuGet VS VSIX/{version}` format with OS info, matching a recognized NuGet.org known client pattern for download statistics visibility

## [1.3.2] - 2026-04-23

### Changed
- Switch NuGet version queries from V3 Flat Container to V3 Registration API (`registration5-gz-semver2`), which provides listing status per version and excludes unlisted packages from update suggestions
- Switch package downloads from V2 API (`www.nuget.org/api/v2/package/`) to V3 Flat Container (`api.nuget.org/v3-flatcontainer/`), fixing User-Agent not appearing in NuGet.org download statistics
- Handle paginated NuGet Registration API responses for packages with 128+ versions (external pages fetched in parallel)

## [1.3.1] - 2026-04-22

### Added
- IntelliSense support for `alcops.json` settings files (autocompletion, validation, documentation) via JSON Schema hosted in the Analyzers repository

## [1.3.0] - 2026-04-17

### Added
- Send `User-Agent` header (`ALCops-VSCode/{version}`) on all NuGet HTTP requests for download statistics tracking on NuGet.org
- Add CI workflow (`.github/workflows/ci.yml`) to run lint, typecheck, and unit tests on pull requests

### Fixed
- Add netstandard fallback in `findMatchingLibFolder` to support AL extension assemblies targeting netstandard2.0 (e.g., netstandard2.1 matches netstandard2.0)
- Update token name for VS Code Marketplace publishing in CI workflow
- Scope `tsconfig.json` to `src/` via `include` and add explicit `types: ["node"]` to fix TS6059 errors from test files outside `rootDir`
- Update `engines.vscode` from `^1.110.0` to `^1.116.0` to match `@types/vscode`, fixing `vsce package` build failure

### Changed
- Replace `pe-struct` PE parsing with lightweight binary `TargetFrameworkAttribute` string search for .NET framework detection, removing the `pe-struct` dependency
- Migrate to unified `typescript-eslint` package, replacing legacy `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`
- Update npm dev dependencies (TypeScript 5.9.3 → 6.0.2 and others)
- Update GitHub Actions dependencies
- Restructure CI into DRY pattern: extract shared `build-test.yml` reusable workflow, rename `ci.yml` to `pull-request.yml`, and have `build-and-release.yml` reuse `build-test.yml` (matching `ALCops/Analyzers` repo pattern)
- Add `vsce package` validation step to CI to catch `@types/vscode` vs `engines.vscode` mismatches on pull requests before merge
- Use `npx vsce` instead of global `npm install -g @vscode/vsce` in build-and-release workflow

## [1.2.5] - 2026-03-29

### Added
- Detect and display third-party code analyzers (e.g., `BusinessCentral.LinterCop.dll`) in the quick-pick menu ([#18](https://github.com/ALCops/vscode-extension/issues/18))
- Group analyzers by source with separator labels: Microsoft Code Analyzers, ALCops Code Analyzers, and Third-Party Analyzers

### Changed
- Added `source` property to `CodeAnalyzerInfo` to distinguish default, ALCops, and third-party analyzers

## [1.2.4] - 2026-03-06

### Fixed
- Removed `extensionDependencies` on AL Language extension to prevent forced activation in non-AL workspaces ([#15](https://github.com/ALCops/vscode-extension/pull/15))

### Changed
- Updated npm dev dependencies
- Updated GitHub Actions dependencies

## [1.2.3] - 2026-02-28

### Added
- Added contributing guidelines (`CONTRIBUTING.md`)

### Changed
- Replaced intrusive notification popups with non-intrusive timed messages using `showTimedMessage`
- Bumped `@types/vscode` from 1.104.0 to 1.109.0 and updated VS Code engine to `^1.109.0`

## [1.2.2] - 2026-02-21

### Fixed
- Resolved two ESLint warnings
- Downgraded `@types/vscode` to `1.104.0` for engine compatibility

### Changed
- Replaced `unzipper` with `fflate` for zip extraction
- Updated GitHub Actions dependencies (including `actions/checkout` v6)
- Updated npm dependencies, including `@vscode/vsce`, `@types/node`, and `eslint`

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