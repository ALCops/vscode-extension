---
applyTo: '**'
---

# Changelog Maintenance

Every pull request that introduces user-facing changes, bug fixes, refactors, or dependency updates **must** include a corresponding entry in `CHANGELOG.md`.

## Rules

1. Add entries under the `## [Unreleased]` section at the top.
2. Follow the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format with these subsection headers:
   - **Added** for new features
   - **Changed** for changes in existing functionality or refactors
   - **Fixed** for bug fixes
   - **Removed** for removed features
   - **Performance** for performance improvements
   - **Deprecated** for soon-to-be removed features
3. Write entries as concise, user-oriented bullet points. Reference issue/PR numbers where applicable (e.g., `([#18](https://github.com/ALCops/vscode-extension/issues/18))`).
4. Group dependency bumps (npm, GitHub Actions) into a single "Update npm dev dependencies" or "Update GitHub Actions dependencies" line under **Changed**, unless a specific bump is noteworthy.
5. Do not create a new version heading. Version headings are added during the release process.
6. If the `## [Unreleased]` section does not exist, create it immediately after the top-level heading and format description.
