# ALCops VS Code Extension

VS Code extension that manages ALCops code analyzers for the AL programming language (Microsoft Dynamics 365 Business Central). It downloads analyzer DLLs from NuGet, deploys them into the AL Language extension's `bin/Analyzers` folder, and provides a quick-pick UI for enabling/disabling analyzers.

## Build and Lint

```bash
npm ci                  # Install dependencies (Node.js v22+)
npm run bundle          # Bundle with esbuild (dev, with sourcemaps)
npm run watch:bundle    # Bundle in watch mode
npm run typecheck       # Type check without emitting
npm run lint            # ESLint
npm run compile         # TypeScript compile (for tests)
npx vsce package        # Package VSIX
```

Run in VS Code: press F5 to launch the Extension Development Host. No test suite exists yet (`npm test` is configured but no test files are present).

## Architecture

### Activation and Startup Flow

`extension.ts` is the entry point. On `onStartupFinished`, it creates three core objects:

1. **VersionManager** — reads `.alcops-manifest.json` from the AL extension's Analyzers folder, tracks installed version, determines if reinstallation is needed (e.g., AL extension updated).
2. **AutoUpdater** — orchestrates the startup sequence: pending deferred installs → reinstallation check → auto-update check. Queries NuGet for latest version, respects the configured version channel (stable/beta/alpha) and notification mode (auto-install/notify-only/manual). Fires `onDidInstallAnalyzers` event on success.
3. **StatusBarManager** — shows active analyzer count in the status bar, registers the `alcops.selectCodeAnalyzers` command (quick-pick UI). Subscribes to `onDidInstallAnalyzers` to refresh after installs.

### Download Pipeline (`downloader.ts`)

All installs go through a single `InstallationMutex` to prevent concurrent downloads. The flow:

1. Download `.nupkg` from NuGet v2 API to a temp directory
2. Extract with `fflate` (pure JS, zero transitive deps)
3. Read `Microsoft.Dynamics.Nav.CodeAnalysis.dll` to determine the target .NET framework (netstandard2.1 vs net8.0) by scanning for the `TargetFrameworkAttribute` metadata string
4. Match the correct `lib/` subfolder from the NuGet package
5. If analyzer DLLs are locked (Windows): defer to next startup or close-and-relaunch VS Code
6. Stage files with backup → copy → rollback on failure (`file-staging.ts`)
7. Write `.alcops-manifest.json` with version, AL extension version, framework, and file list

### Manifest (`manifest-manager.ts`)

`.alcops-manifest.json` in the Analyzers folder is the source of truth for installation state. It tracks: ALCops version, AL extension version at install time, target framework, file list, and optional pending update flags.

### Locked File Handling

On Windows, the AL Language extension locks analyzer DLLs while running. The extension detects EACCES/EPERM/EBUSY errors and offers three options: close window and relaunch, defer to next startup, or cancel. Deferred installs are persisted in the manifest and completed on next activation.

## Conventions

- **Import suffixes**: all local imports must end with `.js` (e.g., `import { foo } from './bar.js'`). Required by the esbuild + TypeScript ESM-style resolution setup.
- **Error formatting**: use `formatError()` from `utils.ts` for all user-facing error messages.
- **User notifications**: use `showTimedMessage()` from `utils.ts` for non-actionable status messages (auto-dismissing). Use `vscode.window.showInformationMessage`/`showErrorMessage` only when user action is needed.
- **Bundling**: esbuild bundles everything into a single `dist/extension.js`. The `vscode` module is external. Runtime dependencies (`fflate`, `semver`) are bundled in.
- **TypeScript strict mode** is enabled. Target is ES2022, module resolution is Node16.
- **ESLint rules**: naming conventions for imports, curly braces required, strict equality (`===`), semicolons required.
- **Versioning**: GitVersion with GitHubFlow calculates SemVer from git history. Never manually edit `version` in `package.json`. Branch from `main`, release via `release/*` branches and `v*` tags.
- **CI checks before PR**: run `npm run lint && npm run typecheck && npm run unit-test`.

## Testing

- **Unit tests**: run `npm run unit-test` (vitest). Test files live in `tests/**/*.test.ts`. Uses `globals: true` so `describe`/`it`/`expect` are available without imports.
- **Fixture DLLs**: minimal stub assemblies in `tests/fixtures/` for testing framework detection. One per target framework (e.g., `compiler-net80/`, `compiler-netstandard21/`).
- **Convention**: always include unit tests for new or refactored functionality. Pure Node.js modules (no VS Code API) should be tested with vitest. Integration tests requiring the VS Code host can use `@vscode/test-cli`.
