import * as vscode from 'vscode';
import { VersionManager } from './version-manager.js';
import { queryLatestVersion, downloadALCopsAnalyzers } from './downloader.js';
import { getPendingUpdate } from './manifest-manager.js';
import { getAnalyzersPath } from './al-extension-handler.js';
import { formatError, showTimedMessage } from './utils.js';

export class AutoUpdater {
    private readonly _onDidInstallAnalyzers = new vscode.EventEmitter<string>();
    /** Fires with the installed version string after every successful analyzer installation. */
    public readonly onDidInstallAnalyzers: vscode.Event<string> = this._onDidInstallAnalyzers.event;

    constructor(private versionManager: VersionManager) { }

    /**
     * Check for updates and handle notifications based on user settings
     */
    async checkAndNotifyUpdates(): Promise<void> {
        try {
            if (!vscode.workspace.getConfiguration('alcops').get<boolean>('automaticUpdates', true)) {
                return;
            }

            if (!this.versionManager.shouldCheckForUpdates()) {
                return;
            }

            await this.performUpdateCheck();
        } catch (error) {
            console.error('Error checking for ALCops updates:', error);
        }
    }

    /**
     * Install a specific version. Owns all user-facing messaging for the install.
     * Re-throws on failure so callers can decide whether to propagate.
     */
    async installUpdate(version: string): Promise<void> {
        showTimedMessage(`ALCops: Installing v${version}...`);
        try {
            await downloadALCopsAnalyzers(version);
            this._onDidInstallAnalyzers.fire(version);
            showTimedMessage(`ALCops v${version} installed successfully.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to install ALCops v${version}: ${formatError(error)}`);
            throw error;
        }
    }

    /**
     * Manually check for updates (called by command)
     */
    async checkUpdatesManually(): Promise<void> {
        try {
            const latestVersion = await queryLatestVersion(this.getVersionChannel());
            if (!latestVersion) {
                vscode.window.showErrorMessage('Could not determine latest ALCops version');
                return;
            }

            const currentVersion = this.versionManager.getInstalledALCopsVersionFromManifest() ?? 'unknown';
            if (currentVersion === latestVersion) {
                showTimedMessage(`ALCops is up to date (v${currentVersion})`);
                return;
            }

            const result = await vscode.window.showInformationMessage(
                this.buildUpdateMessage(currentVersion, latestVersion),
                'Install Now', 'Cancel'
            );
            if (result === 'Install Now') {
                await this.installUpdate(latestVersion);
            }

            await this.versionManager.setLastCheckTime();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to check for updates: ${formatError(error)}`);
        }
    }

    /**
     * Get the configured version channel
     * @private
     */
    private getVersionChannel(): 'stable' | 'beta' | 'alpha' {
        return vscode.workspace.getConfiguration('alcops')
            .get<string>('versionChannel', 'stable') as 'stable' | 'beta' | 'alpha';
    }

    private buildUpdateMessage(currentVersion: string, latestVersion: string): string {
        return currentVersion === 'unknown'
            ? `ALCops: Ready to install version ${latestVersion}`
            : `ALCops update available: ${currentVersion} → ${latestVersion}`;
    }

    /**
     * Handle reinstallation if needed (e.g., AL extension was updated, files are missing)
     * @returns true if installation was attempted and succeeded, false otherwise
     */
    private async ensureValidInstallation(): Promise<boolean> {
        const reinstallCheck = this.versionManager.needsReinstallation();
        if (!reinstallCheck.needed) {
            return false;
        }

        const version = reinstallCheck.suggestedVersion
            ?? this.versionManager.getInstalledALCopsVersionFromManifest()
            ?? null;

        return this.installVersion(version, reinstallCheck.reason ?? 'installation invalid');
    }

    /**
     * Install a specific version (or resolve the latest if null) as part of an automated flow.
     * Owns console logging and user-facing messages for background installs.
     * @returns true on success, false on failure
     */
    private async installVersion(version: string | null, reason: string): Promise<boolean> {
        const targetVersion = version ?? await queryLatestVersion(this.getVersionChannel());
        if (!targetVersion) {
            console.error(`Could not determine version to install (${reason})`);
            return false;
        }

        console.log(`Installing ALCops v${targetVersion} (${reason})...`);
        try {
            await downloadALCopsAnalyzers(targetVersion);
            this._onDidInstallAnalyzers.fire(targetVersion);
            showTimedMessage(`ALCops v${targetVersion} installed successfully.`);
            return true;
        } catch (error) {
            console.error(`Failed to install ALCops v${targetVersion}:`, error);
            vscode.window.showErrorMessage(`Failed to install ALCops: ${formatError(error)}`);
            return false;
        }
    }

    /**
     * Perform the update check and handle notifications
     */
    private async performUpdateCheck(): Promise<void> {
        const latestVersion = await queryLatestVersion(this.getVersionChannel());
        if (!latestVersion) {
            console.log('Could not determine latest ALCops version');
            return;
        }

        await this.versionManager.setLastCheckTime();

        if (!this.versionManager.isNewVersionAvailable(latestVersion)) {
            return;
        }

        const updateNotification = vscode.workspace.getConfiguration('alcops')
            .get<string>('updateNotification', 'notify-only');

        switch (updateNotification) {
            case 'auto-install':
                await this.installUpdate(latestVersion);
                break;
            case 'notify-only':
                await this.notifyUserAboutUpdate(latestVersion);
                break;
        }
    }

    /**
     * Notify the user about an available update with action buttons
     */
    private async notifyUserAboutUpdate(version: string): Promise<void> {
        const currentVersion = this.versionManager.getInstalledALCopsVersionFromManifest() ?? 'unknown';
        const result = await vscode.window.showInformationMessage(
            this.buildUpdateMessage(currentVersion, version),
            'Install Now', 'Remind Later', 'Never'
        );
        switch (result) {
            case 'Install Now':
                await this.installUpdate(version);
                break;
            case 'Remind Later':
                await this.versionManager.setLastCheckTime();
                break;
        }
    }

    /**
     * Handle pending update installation from previous deferred installations
     * @returns true if pending update was found and installed successfully, false otherwise
     */
    private async handlePendingUpdate(): Promise<boolean> {
        const analyzerPath = getAnalyzersPath();
        if (!analyzerPath) {
            return false;
        }

        const pendingVersion = getPendingUpdate(analyzerPath);
        if (!pendingVersion) {
            return false;
        }

        console.log(`Found pending ALCops installation for v${pendingVersion}. Attempting installation...`);
        return this.installVersion(pendingVersion, 'pending deferred installation');
    }

    /**
     * Perform all startup checks: pending installs, reinstallation, and auto-updates
     */
    async performStartupChecks(): Promise<void> {
        try {
            if (await this.handlePendingUpdate()) {
                return;
            }

            if (await this.ensureValidInstallation()) {
                return;
            }

            await this.checkAndNotifyUpdates();
        } catch (error) {
            console.error('Error during startup checks:', error);
        }
    }

    /**
     * Install the latest version from the configured channel
     * Called by the install command
     */
    async installLatestVersion(): Promise<void> {
        const latestVersion = await queryLatestVersion(this.getVersionChannel());
        if (!latestVersion) {
            vscode.window.showErrorMessage('Could not determine latest ALCops version');
            return;
        }
        await this.installUpdate(latestVersion);
    }

    dispose(): void {
        this._onDidInstallAnalyzers.dispose();
    }
}
