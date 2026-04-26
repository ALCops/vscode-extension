---
applyTo: '**'
---

# NuGet User-Agent for Azure DevOps Extension

## Context

The ALCops project has two extensions that download NuGet packages from NuGet.org:

1. **VS Code Extension** (this repo) — already sends `NuGet VS VSIX/{version} (Node.js {v}; {os} {release})` as User-Agent ([PR #34](https://github.com/ALCops/vscode-extension/pull/34))
2. **Azure DevOps Extension** — needs the same treatment with a different client name

The goal is to make downloads from each extension visible and distinguishable in [NuGet.org per-package statistics](https://www.nuget.org/stats/packages/ALCops.Analyzers?groupby=ClientName&groupby=ClientVersion).

## How NuGet.org Download Statistics Work

NuGet.org processes download statistics by parsing **Azure CDN logs** using a Python-based User-Agent parser. The parser has three stages:

1. **Known clients parser** — regex patterns defined in [`knownclients.yaml`](https://github.com/NuGet/NuGetGallery/blob/main/python/StatsLogParser/loginterpretation/knownclients.yaml)
2. **China CDN parser** — same patterns but with `+` replacing spaces (CDN URL-encodes spaces as `+`)
3. **Default `ua-parser` library** — designed for web browsers, does NOT recognize custom `Product/Version` strings

If a User-Agent does not match any known client pattern or browser pattern, it is classified as **"Other"** and hidden from the stats page.

### Key files in [NuGet/NuGetGallery](https://github.com/NuGet/NuGetGallery):

| File | Purpose |
|---|---|
| `python/StatsLogParser/loginterpretation/knownclients.yaml` | Regex patterns for recognized clients |
| `python/StatsLogParser/loginterpretation/useragentparser.py` | Parser logic (known clients → China CDN → default ua-parser) |
| `python/StatsLogParser/tests/test_useragentparser.py` | Test cases for each known client |
| `src/Stats.AzureCdnLogs.Common/CdnLogEntryParser.cs` | CDN log line parser (User-Agent is column 14) |

### Stats page dimensions

The stats page groups by **ClientName** and **ClientVersion** only. OS info in parentheses is captured in CDN logs but NOT exposed as a separate dimension.

## Known Client Patterns Available

From `knownclients.yaml`, these are patterns that could be reused for Azure DevOps:

```yaml
# Already used by VS Code extension:
- regex: '(NuGet VS VSIX)/(\d+)\.(\d+)\.?(\d+)?'
  family_replacement: 'NuGet VS VSIX'

# Potentially suitable for Azure DevOps extension:
- regex: '(vsts-task-installer)/(\d+)\.(\d+)\.?(\d+)?'
  family_replacement: 'vsts-task-installer'

# Other options (less fitting):
- regex: '(NuGet MSBuild Task)/(\d+)\.(\d+)\.?(\d+)?'
  family_replacement: 'NuGet MSBuild Task'
- regex: '(NuGet .NET Core MSBuild Task)/(\d+)\.(\d+)\.?(\d+)?'
  family_replacement: 'NuGet .NET Core MSBuild Task'
```

### Recommended: `vsts-task-installer`

For the Azure DevOps extension, `vsts-task-installer` is the best fit because:
- It literally means "VSTS (Azure DevOps) task installer"
- The Azure DevOps extension IS a task that installs NuGet packages
- ALCops.Analyzers is niche, so actual `vsts-task-installer` downloads for this package should be zero
- The ALCops version numbers distinguish it from the real client

**User-Agent format to use:**
```
vsts-task-installer/{alcops_version} (Node.js {nodeVersion}; {osType} {osRelease})
```

Example: `vsts-task-installer/1.3.3 (Node.js v22.0.0; Linux 5.15.0-1064-azure)`

### Verification

The regex `(vsts-task-installer)/(\d+)\.(\d+)\.?(\d+)?` matches via `re.search()`, so anything after the version (like the OS info in parens) is ignored by the parser. The family will be `vsts-task-installer` and the version groups capture the semver.

## What Was Tested

We installed and tested the actual `ua-parser` Python library used by NuGet.org. Results:

- `ALCops-VSCode/1.3.2` → **Other** (not recognized)
- `ALCops/1.3.2` → **Other** (not recognized)
- `ALCops VSCode Extension/1.3.2 (...)` → **Other** (not recognized)
- Any custom `Product/Version` format → **Other**

**Conclusion: there is no client-side-only User-Agent format that makes a custom client visible in NuGet.org stats. You must either mimic a known client or submit a PR to `knownclients.yaml`.**

## Alternative: Submit a PR to NuGetGallery

If you prefer a proper client name (e.g., "ALCops Azure DevOps Extension") instead of mimicking an existing one, submit a PR to [NuGet/NuGetGallery](https://github.com/NuGet/NuGetGallery). External PRs are regularly accepted:

- [Bonsai PR #10447](https://github.com/NuGet/NuGetGallery/pull/10447) — merged in 5 days (May 2025)
- GetNuTool — added March 2026

The PR is a 2-file change:
1. Add regex to `python/StatsLogParser/loginterpretation/knownclients.yaml`
2. Add test case to `python/StatsLogParser/tests/test_useragentparser.py`

## Implementation Checklist for Azure DevOps Extension

- [ ] Find the HTTP download function (equivalent to `getUserAgent()` + `httpsGetWithRedirects()` in the VS Code extension's `src/downloader.ts`)
- [ ] Change the User-Agent header to: `vsts-task-installer/{version} (Node.js {process.version}; {os.type()} {os.release()})`
- [ ] Add/update unit tests to verify the User-Agent header format
- [ ] Update CHANGELOG
- [ ] Verify the User-Agent is sent on both NuGet API queries AND package downloads (both endpoints go through Azure CDN)

## Current VS Code Extension Implementation (reference)

In `src/downloader.ts`:

```typescript
function getUserAgent(): string {
    const extension = vscode.extensions.getExtension('arthurvdv.alcops');
    const version = extension?.packageJSON?.version ?? '0.0.0';
    return `NuGet VS VSIX/${version} (Node.js ${process.version}; ${os.type()} ${os.release()})`;
}
```

Used in `httpsGetWithRedirects()`:

```typescript
https.get(url, { headers: { 'User-Agent': getUserAgent() } }, (response) => { ... });
```

Applied to both:
- NuGet Registration API queries (`api.nuget.org/v3/registration5-gz-semver2/...`)
- Package downloads (`api.nuget.org/v3-flatcontainer/...`)
