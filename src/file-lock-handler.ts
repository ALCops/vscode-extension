import * as fs from 'fs';
import * as path from 'path';
import { readManifest } from './manifest-manager.js';

/**
 * Result of checking if a file is locked
 */
export interface FileLockCheckResult {
    isLocked: boolean;
    lockedFiles: string[];
    reason?: string;
}

/**
 * Check if a file is locked or inaccessible for writing
 * Windows-specific errors: EACCES (permission denied), EPERM (operation not permitted)
 */
export function isFileLocked(filePath: string): boolean {
    try {
        // Attempt to open file in read-write mode without truncating
        // This will fail if the file is locked by another process
        const fd = fs.openSync(filePath, fs.constants.O_RDWR);
        fs.closeSync(fd);
        return false;
    } catch (error) {
        if (error instanceof Error) {
            const code = (error as any).code;
            // Windows lock-related error codes
            if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
                return true;
            }
        }
        return false;
    }
}

/**
 * Check if a directory contains any locked files
 */
export function checkDirectoryForLockedFiles(
    targetPath: string
): FileLockCheckResult {
    try {
        if (!fs.existsSync(targetPath)) {
            return {
                isLocked: false,
                lockedFiles: [],
            };
        }

        // Read manifest to get list of ALCops files to check
        const manifest = readManifest(targetPath);
        const filesToCheck = manifest?.files || [];

        // If no manifest exists or no files listed, nothing to check
        if (filesToCheck.length === 0) {
            return {
                isLocked: false,
                lockedFiles: [],
            };
        }

        const lockedFiles: string[] = [];

        // Only check files listed in the manifest
        for (const file of filesToCheck) {
            const filePath = path.join(targetPath, file);

            // Skip if file doesn't exist (will be updated anyway)
            if (!fs.existsSync(filePath)) {
                continue;
            }

            if (isFileLocked(filePath)) {
                lockedFiles.push(file);
            }
        }

        if (lockedFiles.length > 0) {
            return {
                isLocked: true,
                lockedFiles,
                reason: `${lockedFiles.length} ALCops file(s) are locked by another process`,
            };
        }

        return {
            isLocked: false,
            lockedFiles: [],
        };
    } catch (error) {
        return {
            isLocked: false,
            lockedFiles: [],
            reason: `Error checking for locked files: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Attempt to create a test file in the target directory to verify write access
 * This is a more reliable check for directory write access on Windows
 */
export function canWriteToDirectory(targetPath: string): boolean {
    const testFileName = '.alcops-write-test';
    const testFilePath = path.join(targetPath, testFileName);

    try {
        // Ensure directory exists
        if (!fs.existsSync(targetPath)) {
            return false;
        }

        // Try to write a test file
        fs.writeFileSync(testFilePath, 'test', 'utf-8');

        // Clean up
        fs.unlinkSync(testFilePath);

        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Get a list of locked files in the target directory
 */
export function getLockedFiles(targetPath: string): string[] {
    const result = checkDirectoryForLockedFiles(targetPath);
    return result.lockedFiles;
}
