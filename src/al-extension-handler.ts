import * as vscode from 'vscode';
import { getLockedFiles } from './file-lock-handler.js';

/**
 * Result of checking AL extension process status
 */
export interface ALExtensionStatus {
    isRunning: boolean;
    hasLocks: boolean;
    lockedFiles: string[];
    message: string;
}

/**
 * Check if AL extension is currently running
 */
export function isALExtensionRunning(): boolean {
    try {
        const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
        if (!alExtension) {
            return false;
        }

        // Extension is activated if it's in the extensions list
        return alExtension.isActive;
    } catch (error) {
        console.warn('Error checking AL extension status:', error);
        return false;
    }
}

/**
 * Comprehensive check of AL extension status and potential file locks
 */
export function checkALExtensionStatus(analyzerPath: string): ALExtensionStatus {
    const isRunning = isALExtensionRunning();
    const lockedFiles = getLockedFiles(analyzerPath);
    const hasLocks = lockedFiles.length > 0;

    let message = '';
    if (isRunning && hasLocks) {
        message = `AL extension is running and ${lockedFiles.length} analyzer file(s) are locked.`;
    } else if (isRunning && !hasLocks) {
        message = 'AL extension is running but no file locks detected.';
    } else if (!isRunning && hasLocks) {
        message = `${lockedFiles.length} analyzer file(s) are locked (AL extension appears inactive).`;
    } else {
        message = 'AL extension is not running and no file locks detected.';
    }

    return {
        isRunning,
        hasLocks,
        lockedFiles,
        message,
    };
}

/**
 * Show user-friendly dialog for locked files scenario
 */
export async function promptUserForLockedFiles(
    analyzerPath: string,
    targetVersion: string
): Promise<'reload' | 'defer' | 'cancel'> {
    const status = checkALExtensionStatus(analyzerPath);

    if (!status.hasLocks) {
        return 'reload'; // No locks, proceed normally
    }

    const lockedFilesList = status.lockedFiles.join(', ');
    const message = `Files are locked by the AL extension: ${lockedFilesList}\n\nHow would you like to proceed?`;

    const result = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Reload VS Code',
        'Install on Next Start'
    );

    switch (result) {
        case 'Reload VS Code':
            return 'reload';
        case 'Install on Next Start':
            return 'defer';
        default:
            return 'cancel';
    }
}

/**
 * Show info message about deferred installation
 */
export async function showDeferredInstallationMessage(version: string): Promise<void> {
    await vscode.window.showInformationMessage(
        `Installation of ALCops v${version} has been scheduled for the next VS Code startup. Please reload VS Code when convenient.`,
        'Reload Now'
    ).then((result) => {
        if (result === 'Reload Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    });
}

/**
 * Show error message with suggestions for locked files
 */
export async function showLockedFilesError(error: Error, analyzerPath: string): Promise<void> {
    const status = checkALExtensionStatus(analyzerPath);

    let suggestion = 'Please try again or reload VS Code.';
    if (status.hasLocks) {
        suggestion = `Locked files: ${status.lockedFiles.join(', ')}. Try reloading VS Code to release the locks.`;
    }

    await vscode.window.showErrorMessage(
        `Failed to install ALCops: ${error.message}\n\n${suggestion}`
    );
}
