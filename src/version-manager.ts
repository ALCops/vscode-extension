import * as vscode from 'vscode';
import { readManifest } from './manifest-manager.js';
import { getALExtension, getAnalyzersPath } from './al-extension-handler.js';

const LAST_UPDATE_CHECK_KEY = 'alcops.lastUpdateCheck';

export class VersionManager {
    constructor(private context: vscode.ExtensionContext) { }

    /**
     * Get the timestamp of the last update check
     */
    getLastCheckTime(): number | undefined {
        return this.context.globalState.get<number>(LAST_UPDATE_CHECK_KEY);
    }

    /**
     * Set the timestamp of the last update check to now
     */
    async setLastCheckTime(): Promise<void> {
        await this.context.globalState.update(LAST_UPDATE_CHECK_KEY, Date.now());
    }

    /**
     * Check if we should perform an update check based on the configured interval
     */
    shouldCheckForUpdates(): boolean {
        const checkIntervalHours = vscode.workspace.getConfiguration('alcops').get<number>('checkUpdateInterval', 24);
        const checkIntervalMs = checkIntervalHours * 60 * 60 * 1000;
        const lastCheck = this.getLastCheckTime();

        if (lastCheck === undefined) {
            return true; // Never checked before
        }

        return Date.now() - lastCheck >= checkIntervalMs;
    }

    /**
     * Check if a new version is available (different from installed version in manifest)
     */
    isNewVersionAvailable(latestVersion: string): boolean {
        const installedVersion = this.getInstalledALCopsVersionFromManifest();
        return !installedVersion || installedVersion !== latestVersion;
    }

    /**
     * Check if the AL extension has been updated since the last installation
     */
    hasALExtensionChanged(currentExtension: vscode.Extension<any>): boolean {
        const manifestVersion = this.getALExtensionVersionFromManifest();
        const currentVersion = currentExtension.packageJSON.version;

        // Extension changed if there's no manifest or version differs
        return !manifestVersion || manifestVersion !== currentVersion;
    }

    /**
     * Generic helper to read and extract a value from the manifest
     * Handles AL extension lookup, manifest reading, and error handling
     * @private
     */
    private readManifestValue<T>(extractor: (manifest: any) => T | undefined): T | null {
        try {
            const targetPath = getAnalyzersPath();
            if (!targetPath) {
                return null;
            }

            const manifest = readManifest(targetPath);
            if (!manifest) {
                return null;
            }

            return extractor(manifest) || null;
        } catch (error) {
            console.warn(`Failed to read manifest value: ${error}`);
            return null;
        }
    }

    /**
     * Get the installed ALCops version from the manifest file
     * This reads from the manifest in the AL extension's Analyzers folder
     */
    getInstalledALCopsVersionFromManifest(): string | null {
        return this.readManifestValue(m => m.alcopsVersion);
    }

    /**
     * Get the AL extension version from the manifest
     * This returns what version of AL extension was present when ALCops was installed
     */
    getALExtensionVersionFromManifest(): string | null {
        return this.readManifestValue(m => m.alExtensionVersion);
    }

    /**
     * Check if ALCops installation is missing or needs reinstallation
     * This includes checking for AL extension changes or missing files
     */
    needsReinstallation(): { needed: boolean; reason?: string; suggestedVersion?: string } {
        const alExtension = getALExtension();

        if (!alExtension) {
            return { needed: false, reason: 'AL extension not installed' };
        }

        // Check if AL extension has changed
        if (this.hasALExtensionChanged(alExtension)) {
            const previousVersion = this.getInstalledALCopsVersionFromManifest();
            return {
                needed: true,
                reason: 'AL extension has been updated',
                suggestedVersion: previousVersion || undefined
            };
        }

        // Check if manifest exists
        const installedVersion = this.getInstalledALCopsVersionFromManifest();
        if (!installedVersion) {
            return {
                needed: true,
                reason: 'No ALCops installation found'
            };
        }

        return { needed: false };
    }
}
