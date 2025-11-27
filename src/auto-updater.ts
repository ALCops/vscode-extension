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

            // Attempt recovery if installation is invalid or missing
            if (await this.tryRecoverInstallation()) {
                return; // Recovery was attempted, skip normal update check
            }

            // Check if enough time has passed since last check
            if (!this.versionManager.shouldCheckForUpdates()) {
                return; // Not enough time has passed since last check
            }

            // Perform normal update check
            await this.performUpdateCheck();

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
            const latestVersion = await queryLatestVersion(this.getVersionChannel());

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

    /**
     * Get the configured version channel
     * @private
     */
    private getVersionChannel(): 'stable' | 'beta' | 'alpha' {
        return vscode.workspace.getConfiguration('alcops')
            .get<string>('versionChannel', 'stable') as 'stable' | 'beta' | 'alpha';
    }

    /**
     * Try to recover installation if it's invalid or missing
     * @private
     * @returns true if recovery was attempted (success or failure), false if no recovery needed
     */
    private async tryRecoverInstallation(): Promise<boolean> {
        const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
        if (!alExtension) {
            return false;
        }

        const targetPath = path.join(alExtension.extensionPath, 'bin', 'Analyzers');
        const verification = verifyAnalyzerInstallation(targetPath);

        if (verification.isValid) {
            return false; // No recovery needed
        }

        // Check if reinstallation is needed
        const reinstallCheck = this.versionManager.needsReinstallation();
        if (!reinstallCheck.needed) {
            return false;
        }

        // Determine version to install
        const versionToRecover = reinstallCheck.suggestedVersion ||
            this.versionManager.getInstalledALCopsVersionFromManifest();

        if (versionToRecover) {
            return await this.recoverSpecificVersion(versionToRecover, reinstallCheck.reason);
        } else {
            return await this.recoverLatestVersion(reinstallCheck.reason);
        }
    }

    /**
     * Recover a specific version
     * @private
     */
    private async recoverSpecificVersion(version: string, reason?: string): Promise<boolean> {
        console.log(`Installation invalid (${reason}). Attempting recovery of v${version}...`);
        try {
            await downloadALCopsAnalyzers(version, this.versionManager);
            console.log('Installation recovered successfully.');
            return true;
        } catch (error) {
            console.error('Failed to recover installation:', error);
            return true; // Still attempted recovery
        }
    }

    /**
     * Recover by installing the latest version
     * @private
     */
    private async recoverLatestVersion(reason?: string): Promise<boolean> {
        console.log(`Installation invalid (${reason}). No previous version found, attempting to install latest...`);

        const latestVersion = await queryLatestVersion(this.getVersionChannel());
        if (!latestVersion) {
            console.error('Could not determine latest version for recovery');
            return true; // Still attempted recovery
        }

        try {
            await downloadALCopsAnalyzers(latestVersion, this.versionManager);
            console.log(`Latest version v${latestVersion} installed successfully.`);
            return true;
        } catch (error) {
            console.error('Failed to install latest version:', error);
            return true; // Still attempted recovery
        }
    }

    /**
     * Perform the update check and handle notifications
     * @private
     */
    private async performUpdateCheck(): Promise<void> {
        const latestVersion = await queryLatestVersion(this.getVersionChannel());

        if (!latestVersion) {
            console.log('Could not determine latest ALCops version');
            return;
        }

        await this.versionManager.setLastCheckTime();

        if (!this.versionManager.isNewVersionAvailable(latestVersion)) {
            return; // Already on latest version
        }

        // Handle update based on notification preference
        const updateNotification = vscode.workspace.getConfiguration('alcops')
            .get<string>('updateNotification', 'notify-only');

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
    }

    /**
     * Handle pending update installation from previous deferred installations
     * @private
     * @returns true if pending update was found and handled, false otherwise
     */
    private async handlePendingUpdate(): Promise<boolean> {
        const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
        if (!alExtension) {
            return false;
        }

        const analyzerPath = path.join(alExtension.extensionPath, 'bin', 'Analyzers');
        const { getPendingUpdate } = await import('./manifest-manager.js');
        const pendingVersion = getPendingUpdate(analyzerPath);

        console.log(`Pending version check: ${pendingVersion ? `Found v${pendingVersion}` : 'No pending installation'}`);

        if (!pendingVersion) {
            return false;
        }

        console.log(`Found pending ALCops installation for version ${pendingVersion}. Attempting installation...`);

        try {
            await downloadALCopsAnalyzers(pendingVersion, this.versionManager);
            console.log(`Pending installation of ALCops v${pendingVersion} completed successfully.`);
            vscode.window.showInformationMessage(`ALCops v${pendingVersion} has been successfully installed!`);
            return true;
        } catch (error) {
            console.error(`Failed to install pending ALCops update: ${error}`);
            console.log(`Pending flag will be retained for next startup retry`);
            return true; // Still handled, even if failed
        }
    }

    /**
     * Handle reinstallation if needed (e.g., AL extension was updated)
     * @private
     * @returns true if reinstallation was needed and handled, false otherwise
     */
    private async handleReinstallation(): Promise<boolean> {
        const reinstallCheck = this.versionManager.needsReinstallation();

        if (!reinstallCheck.needed) {
            return false;
        }

        console.log(`ALCops reinstallation needed: ${reinstallCheck.reason}`);

        const versionToInstall = reinstallCheck.suggestedVersion;

        if (versionToInstall) {
            return await this.reinstallSpecificVersion(versionToInstall);
        } else {
            return await this.reinstallLatestVersion();
        }
    }

    /**
     * Reinstall a specific version
     * @private
     */
    private async reinstallSpecificVersion(version: string): Promise<boolean> {
        try {
            console.log(`Reinstalling ALCops v${version} for updated AL extension...`);
            await downloadALCopsAnalyzers(version, this.versionManager);
            console.log(`ALCops v${version} reinstalled successfully.`);
            vscode.window.showInformationMessage(`ALCops v${version} has been reinstalled for the updated AL extension.`);
            return true;
        } catch (error) {
            console.error(`Failed to reinstall ALCops: ${error}`);
            vscode.window.showErrorMessage(`Failed to reinstall ALCops: ${error instanceof Error ? error.message : String(error)}`);
            return true; // Still handled, even if failed
        }
    }

    /**
     * Reinstall by installing the latest version
     * @private
     */
    private async reinstallLatestVersion(): Promise<boolean> {
        try {
            console.log('No previous ALCops version found. Installing latest...');
            const latestVersion = await queryLatestVersion(this.getVersionChannel());

            if (!latestVersion) {
                console.error('Could not determine latest ALCops version');
                return true; // Still handled
            }

            await downloadALCopsAnalyzers(latestVersion, this.versionManager);
            console.log(`ALCops v${latestVersion} installed successfully.`);
            vscode.window.showInformationMessage(`ALCops v${latestVersion} has been installed.`);
            return true;
        } catch (error) {
            console.error(`Failed to install latest ALCops: ${error}`);
            vscode.window.showErrorMessage(`Failed to install ALCops: ${error instanceof Error ? error.message : String(error)}`);
            return true; // Still handled, even if failed
        }
    }

    /**
     * Perform all startup checks including pending updates, reinstallation, and auto-updates
     * This is called once during extension activation
     */
    async performStartupChecks(): Promise<void> {
        try {
            // Check for pending updates
            if (await this.handlePendingUpdate()) {
                return; // Pending update handled, skip other checks
            }

            // Check for reinstallation needs
            if (await this.handleReinstallation()) {
                return; // Reinstallation handled, skip normal update check
            }

            // Perform normal update check
            await this.checkAndNotifyUpdates();

        } catch (error) {
            console.error('Error during startup checks:', error);
            // Continue silently - don't interrupt extension activation
        }
    }

    /**
     * Install the latest version from the configured channel
     * Called by the install command
     */
    async installLatestVersion(): Promise<void> {
        try {
            const latestVersion = await queryLatestVersion(this.getVersionChannel());

            if (latestVersion) {
                await this.installUpdate(latestVersion);
            } else {
                vscode.window.showErrorMessage('Could not determine latest ALCops version');
            }
        } catch (error) {
            console.error('Install latest version failed:', error);
            throw error;
        }
    }
}
