import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    version: '1.125.0',
    extensions: {
        getExtension: () => ({ packageJSON: { version: '0.0.0-test' } }),
    },
    workspace: {
        getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
    },
}));

import { formatTooltipMarkdown, formatClipboardText, formatVersionBanner } from '../src/version-info.js';
import type { VersionInfo, EnvironmentInfo } from '../src/version-info.js';

const env: EnvironmentInfo = {
    vscodeVersion: '1.125.0',
    platform: 'win32',
    arch: 'x64',
    osType: 'Windows_NT',
    osRelease: '10.0.26200',
};

const installed: VersionInfo = {
    extensionVersion: '1.3.3',
    analyzersVersion: '0.9.2',
    channel: 'stable',
    alExtensionVersion: '18.0.123456',
    analyzersPath: 'C:\\ext\\al\\bin',
    downloadedAt: '2026-09-01T10:00:00.000Z',
    targetFramework: 'net8.0',
};

const notInstalled: VersionInfo = {
    extensionVersion: '1.3.3',
    analyzersVersion: null,
    channel: 'beta',
    alExtensionVersion: '18.0.123456',
    analyzersPath: 'C:\\ext\\al\\bin',
    downloadedAt: null,
    targetFramework: null,
};

const alMissing: VersionInfo = {
    extensionVersion: '1.3.3',
    analyzersVersion: null,
    channel: 'stable',
    alExtensionVersion: null,
    analyzersPath: null,
    downloadedAt: null,
    targetFramework: null,
};

describe('formatTooltipMarkdown', () => {
    it('lists all versions when everything is installed', () => {
        const tooltip = formatTooltipMarkdown(installed, 3);

        expect(tooltip).toContain('**ALCops**');
        expect(tooltip).toContain('Extension: v1.3.3');
        expect(tooltip).toContain('Analyzers: v0.9.2 (stable channel)');
        expect(tooltip).toContain('AL Language: v18.0.123456');
        expect(tooltip).toContain('Click to select Code Analyzers (3 active)');
    });

    it('uses markdown line breaks between the version lines', () => {
        expect(formatTooltipMarkdown(installed, 1)).toContain('**ALCops**  \nExtension: v1.3.3');
    });

    it('reports the configured channel', () => {
        expect(formatTooltipMarkdown({ ...installed, channel: 'alpha' }, 0)).toContain('(alpha channel)');
    });

    it('shows "not installed" when the analyzers are missing', () => {
        const tooltip = formatTooltipMarkdown(notInstalled, 0);

        expect(tooltip).toContain('Analyzers: not installed');
        expect(tooltip).toContain('AL Language: v18.0.123456');
        expect(tooltip).toContain('Click to select Code Analyzers (0 active)');
    });

    it('shows "not installed" when the AL extension is missing', () => {
        const tooltip = formatTooltipMarkdown(alMissing, 0);

        expect(tooltip).toContain('Analyzers: not installed');
        expect(tooltip).toContain('AL Language: not installed');
    });
});

describe('formatClipboardText', () => {
    it('includes every detail when the analyzers are installed', () => {
        expect(formatClipboardText(installed, env)).toBe([
            'ALCops extension: 1.3.3',
            'ALCops.Analyzers: 0.9.2 (channel: stable)',
            'AL Language extension: 18.0.123456',
            'VS Code: 1.125.0',
            'OS: win32 x64 (Windows_NT 10.0.26200)',
            'Analyzers path: C:\\ext\\al\\bin',
            'Downloaded at: 2026-09-01T10:00:00.000Z',
            'Target framework: net8.0',
        ].join('\n'));
    });

    it('omits the download and framework lines when not installed', () => {
        const text = formatClipboardText(notInstalled, env);

        expect(text).toContain('ALCops.Analyzers: not installed');
        expect(text).not.toContain('Downloaded at:');
        expect(text).not.toContain('Target framework:');
    });

    it('reports the missing AL extension and analyzers path', () => {
        const text = formatClipboardText(alMissing, env);

        expect(text).toContain('AL Language extension: not installed');
        expect(text).toContain('Analyzers path: not installed');
    });

    it('falls back to the live environment when none is passed', () => {
        expect(formatClipboardText(installed)).toContain('VS Code: 1.125.0');
    });
});

describe('formatVersionBanner', () => {
    it('summarizes all three versions on one line', () => {
        expect(formatVersionBanner(installed)).toBe(
            'Extension v1.3.3 | ALCops.Analyzers v0.9.2 (stable channel) | AL Language v18.0.123456'
        );
    });

    it('reports missing components', () => {
        expect(formatVersionBanner(alMissing)).toBe(
            'Extension v1.3.3 | ALCops.Analyzers not installed | AL Language not installed'
        );
    });
});
