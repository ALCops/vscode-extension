import * as vscode from 'vscode';
import * as path from 'path';
import { VersionManager } from './version-manager.js';
import { queryLatestVersion, downloadALCopsAnalyzers, verifyAnalyzerInstallation } from './downloader.js';

export class AutoUpdater {
    constructor(private versionManager: VersionManager) { }

    /**
     * Check for updates and handle notifications based on user settings
     */
    async checkAndNotifyUpdates(): Promise<void> {
        try {
            const automaticUpdates = vscode.workspace.getConfiguration('alcops').get<boolean>('automaticUpdates', true);

            if (!automaticUpdates) {
                return; // Updates are disabled
            }

            // Check if installation files are missing and recover if needed
            const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
            if (alExtension) {
                const targetPath = path.join(alExtension.extensionPath, 'bin', 'Analyzers');
                const verification = verifyAnalyzerInstallation(targetPath);
                const installedVersion = this.versionManager.getInstalledALCopsVersionFromManifest();

                if (!verification.isValid && installedVersion) {
                    console.log(`Installation invalid: ${verification.reason}. Attempting recovery of v${installedVersion}...`);
                    try {
                        await downloadALCopsAnalyzers(installedVersion, this.versionManager);
                        console.log('Installation recovered successfully.');
                        return;
                    } catch (error) {
                        console.error('Failed to recover installation:', error);
                    }
                }
            }

            if (!this.versionManager.shouldCheckForUpdates()) {
                return; // Not enough time has passed since last check
            }

            const versionChannel = vscode.workspace.getConfiguration('alcops').get<string>('versionChannel', 'stable') as 'stable' | 'beta' | 'alpha';
            const latestVersion = await queryLatestVersion(versionChannel);

            if (!latestVersion) {
                console.log('Could not determine latest ALCops version');
                return;
            }

            await this.versionManager.setLastCheckTime();

            if (!this.versionManager.isNewVersionAvailable(latestVersion)) {
                return; // Already on latest version
            }

            // Handle update based on notification preference
            const updateNotification = vscode.workspace.getConfiguration('alcops').get<string>('updateNotification', 'notify-only');

            switch (updateNotification) {
                case 'auto-install':
                    await this.autoInstallUpdate(latestVersion);
                    break;
                case 'notify-only':
                    await this.notifyUserAboutUpdate(latestVersion);
                    break;
                case 'manual':
                    // Do nothing - user will manually trigger updates
                    break;
            }
        } catch (error) {
            console.error('Error checking for ALCops updates:', error);
            // Silently fail - don't interrupt the user's session
        }
    }

    /**
     * Automatically install the update silently
     */
    private async autoInstallUpdate(version: string): Promise<void> {
        try {
            vscode.window.showInformationMessage(`ALCops: Installing update to version ${version}...`);

            await downloadALCopsAnalyzers(version, this.versionManager);

            vscode.window.showInformationMessage(`ALCops successfully updated to version ${version}. Please reload VS Code to apply changes.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to auto-install ALCops update: ${errorMessage}`);
        }
    }

    /**
     * Notify the user about an available update with action buttons
     */
    private async notifyUserAboutUpdate(version: string): Promise<void> {
        const currentVersion = this.versionManager.getInstalledALCopsVersionFromManifest() || 'unknown';
        const message = currentVersion === 'unknown'
            ? `ALCops: Ready to install version ${version}`
            : `ALCops update available: ${currentVersion} → ${version}`;

        const result = await vscode.window.showInformationMessage(
            message,
            'Install Now',
            'Remind Later',
            'Never'
        );

        switch (result) {
            case 'Install Now':
                await this.installUpdate(version);
                break;
            case 'Never':
                // Do nothing - user declined the update
                break;
            case 'Remind Later':
                // Reset last check time to ask again soon
                await this.versionManager.setLastCheckTime();
                break;
        }
    }

    /**
     * Install a specific version (public method for manual installation)
     */
    async installUpdate(version: string): Promise<void> {
        try {
            vscode.window.showInformationMessage(`ALCops: Installing update to version ${version}...`);

            await downloadALCopsAnalyzers(version, this.versionManager);

            vscode.window.showInformationMessage(`ALCops successfully updated to version ${version}. Please reload VS Code to apply changes.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to install ALCops update: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Manually check for updates (can be called by command)
     */
    async checkUpdatesManually(): Promise<void> {
        try {
            const versionChannel = vscode.workspace.getConfiguration('alcops').get<string>('versionChannel', 'stable') as 'stable' | 'beta' | 'alpha';
            const latestVersion = await queryLatestVersion(versionChannel);

            if (!latestVersion) {
                vscode.window.showErrorMessage('Could not determine latest ALCops version');
                return;
            }

            const currentVersion = this.versionManager.getInstalledALCopsVersionFromManifest() || 'unknown';

            if (currentVersion === latestVersion) {
                vscode.window.showInformationMessage(`ALCops is up to date (v${currentVersion})`);
                return;
            }

            const message = currentVersion === 'unknown'
                ? `ALCops: Ready to install version ${latestVersion}`
                : `ALCops update available: ${currentVersion} → ${latestVersion}`;

            vscode.window.showInformationMessage(
                message,
                'Install Now',
                'Cancel'
            ).then(async (result) => {
                if (result === 'Install Now') {
                    await this.installUpdate(latestVersion);
                }
            });

            await this.versionManager.setLastCheckTime();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to check for updates: ${errorMessage}`);
        }
    }
}
