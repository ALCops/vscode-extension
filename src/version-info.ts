import * as os from 'os';
import * as vscode from 'vscode';
import { readManifest } from './manifest-manager.js';
import { getALExtension, getAnalyzersPath } from './al-extension-handler.js';

const EXTENSION_ID = 'arthurvdv.alcops';
const NOT_INSTALLED = 'not installed';

/**
 * Everything needed to answer "which versions am I running?" - shared by the
 * status bar tooltip, the copy-to-clipboard command and the log banners.
 */
export interface VersionInfo {
    /** Version of this VS Code extension. */
    extensionVersion: string;
    /** Installed ALCops.Analyzers version, or null when not installed. */
    analyzersVersion: string | null;
    /** Configured `alcops.versionChannel`. */
    channel: string;
    /** Version of the AL Language extension, or null when not installed. */
    alExtensionVersion: string | null;
    /** Folder the analyzer DLLs live in, or null when it cannot be resolved. */
    analyzersPath: string | null;
    /** When the analyzers were downloaded, or null when not installed. */
    downloadedAt: string | null;
    /** Target framework the analyzers were installed for, or null when not installed. */
    targetFramework: string | null;
}

/**
 * Host details included in the clipboard block. Passing these in explicitly
 * keeps {@link formatClipboardText} pure and unit-testable.
 */
export interface EnvironmentInfo {
    vscodeVersion: string;
    platform: string;
    arch: string;
    osType: string;
    osRelease: string;
}

/**
 * Collect the current version information (one manifest read).
 */
export function gatherVersionInfo(): VersionInfo {
    const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version ?? 'unknown';
    const channel = vscode.workspace.getConfiguration('alcops').get<string>('versionChannel', 'stable');
    const alExtensionVersion = getALExtension()?.packageJSON?.version ?? null;
    const analyzersPath = getAnalyzersPath();
    const manifest = analyzersPath ? readManifest(analyzersPath) : null;

    // A manifest created for a pending update carries the literal 'unknown'
    // placeholder; that is not an installed version.
    const analyzersVersion = manifest && manifest.alcopsVersion && manifest.alcopsVersion !== 'unknown'
        ? manifest.alcopsVersion
        : null;

    return {
        extensionVersion,
        analyzersVersion,
        channel,
        alExtensionVersion,
        analyzersPath,
        downloadedAt: analyzersVersion ? manifest?.downloadedAt ?? null : null,
        targetFramework: analyzersVersion ? manifest?.targetFramework ?? null : null,
    };
}

/**
 * Collect the host details for the clipboard block.
 */
export function gatherEnvironmentInfo(): EnvironmentInfo {
    return {
        vscodeVersion: vscode.version,
        platform: process.platform,
        arch: process.arch,
        osType: os.type(),
        osRelease: os.release(),
    };
}

/**
 * Markdown shown when hovering the status bar item.
 */
export function formatTooltipMarkdown(info: VersionInfo, activeCount: number): string {
    const analyzers = info.analyzersVersion
        ? `v${info.analyzersVersion} (${info.channel} channel)`
        : NOT_INSTALLED;
    const alLanguage = info.alExtensionVersion ? `v${info.alExtensionVersion}` : NOT_INSTALLED;

    // Two trailing spaces force a markdown line break inside the tooltip.
    const header = [
        '**ALCops**',
        `Extension: v${info.extensionVersion}`,
        `Analyzers: ${analyzers}`,
        `AL Language: ${alLanguage}`,
    ].join('  \n');

    return `${header}\n\nClick to select Code Analyzers (${activeCount} active)`;
}

/**
 * Ready-to-paste diagnostics block for issue reports.
 */
export function formatClipboardText(info: VersionInfo, env: EnvironmentInfo = gatherEnvironmentInfo()): string {
    const lines = [
        `ALCops extension: ${info.extensionVersion}`,
        `ALCops.Analyzers: ${info.analyzersVersion ? `${info.analyzersVersion} (channel: ${info.channel})` : NOT_INSTALLED}`,
        `AL Language extension: ${info.alExtensionVersion ?? NOT_INSTALLED}`,
        `VS Code: ${env.vscodeVersion}`,
        `OS: ${env.platform} ${env.arch} (${env.osType} ${env.osRelease})`,
        `Analyzers path: ${info.analyzersPath ?? NOT_INSTALLED}`,
    ];

    if (info.downloadedAt) {
        lines.push(`Downloaded at: ${info.downloadedAt}`);
    }
    if (info.targetFramework) {
        lines.push(`Target framework: ${info.targetFramework}`);
    }

    return lines.join('\n');
}

/**
 * Single-line summary written to the output channel on activation and after
 * every analyzer installation.
 */
export function formatVersionBanner(info: VersionInfo): string {
    const analyzers = info.analyzersVersion
        ? `v${info.analyzersVersion} (${info.channel} channel)`
        : NOT_INSTALLED;
    const alLanguage = info.alExtensionVersion ? `v${info.alExtensionVersion}` : NOT_INSTALLED;

    return `Extension v${info.extensionVersion} | ALCops.Analyzers ${analyzers} | AL Language ${alLanguage}`;
}
