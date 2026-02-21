import * as vscode from 'vscode';
import * as path from 'path';
import { checkDirectoryForLockedFiles } from './file-lock-handler.js';

const AL_EXTENSION_ID = 'ms-dynamics-smb.al';

/**
 * Get the AL extension, or null if not installed
 */
export function getALExtension(): vscode.Extension<any> | null {
    return vscode.extensions.getExtension(AL_EXTENSION_ID) || null;
}

/**
 * Get the path to the Analyzers folder inside the AL extension.
 * Returns null if the AL extension is not installed.
 */
export function getAnalyzersPath(): string | null {
    const ext = getALExtension();
    return ext ? path.join(ext.extensionPath, 'bin', 'Analyzers') : null;
}

interface ALExtensionStatus {
    isRunning: boolean;
    hasLocks: boolean;
    lockedFiles: string[];
    message: string;
}

function checkALExtensionStatus(analyzerPath: string): ALExtensionStatus {
    let isRunning = false;
    try {
        const alExtension = getALExtension();
        isRunning = alExtension?.isActive ?? false;
    } catch (error) {
        console.warn('Error checking AL extension status:', error);
    }
    const lockedFiles = checkDirectoryForLockedFiles(analyzerPath).lockedFiles;
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

    return { isRunning, hasLocks, lockedFiles, message };
}

/**
 * Show user-friendly dialog for locked files scenario.
 * Only call this when locks are confirmed to exist.
 */
export async function promptUserForLockedFiles(
    analyzerPath: string,
    targetVersion: string
): Promise<'close-relaunch' | 'defer' | 'cancel'> {
    const status = checkALExtensionStatus(analyzerPath);

    const lockedFilesList = status.lockedFiles.join(', ');
    const message =
        `ALCops v${targetVersion} cannot be installed because analyzer files are locked by the AL Language extension: ${lockedFilesList}\n\n` +
        `To install, VS Code needs to close this window and open a new empty window (without an AL project). ` +
        `Please also close any other VS Code windows where an AL project is open before proceeding.`;

    const result = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Close Window & Relaunch',
        'Install on Next Start'
    );

    switch (result) {
        case 'Close Window & Relaunch':
            return 'close-relaunch';
        case 'Install on Next Start':
            return 'defer';
        default:
            return 'cancel';
    }
}
