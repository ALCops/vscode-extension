import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents the manifest metadata for ALCops analyzer installation
 */
export interface ALCopsManifest {
    alcopsVersion: string;
    alExtensionVersion: string;
    downloadedAt: string;
    targetFramework: string;
    files: string[];
    pendingUpdate?: boolean;
    pendingVersion?: string;
}

const MANIFEST_FILE_NAME = '.alcops-manifest.json';

/**
 * Write the manifest file to the Analyzers folder
 */
export function writeManifest(
    targetPath: string,
    manifest: ALCopsManifest
): void {
    try {
        const manifestPath = path.join(targetPath, MANIFEST_FILE_NAME);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (error) {
        throw new Error(`Failed to write manifest file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Read the manifest file from the Analyzers folder
 */
export function readManifest(targetPath: string): ALCopsManifest | null {
    try {
        const manifestPath = path.join(targetPath, MANIFEST_FILE_NAME);

        if (!fs.existsSync(manifestPath)) {
            return null;
        }

        const data = fs.readFileSync(manifestPath, 'utf-8');
        return JSON.parse(data) as ALCopsManifest;
    } catch (error) {
        console.warn(`Failed to read manifest file: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Delete the manifest file from the Analyzers folder
 */
export function deleteManifest(targetPath: string): void {
    try {
        const manifestPath = path.join(targetPath, MANIFEST_FILE_NAME);

        if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
        }
    } catch (error) {
        console.warn(`Failed to delete manifest file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Create a manifest from downloaded files
 */
export function createManifest(
    alcopsVersion: string,
    alExtensionVersion: string,
    targetFramework: string,
    sourceLibPath: string
): ALCopsManifest {
    const files = fs.readdirSync(sourceLibPath);

    return {
        alcopsVersion,
        alExtensionVersion,
        downloadedAt: new Date().toISOString(),
        targetFramework,
        files,
    };
}

/**
 * Mark a version as pending for installation on next startup
 */
export function markAsPendingUpdate(
    targetPath: string,
    pendingVersion: string
): void {
    try {
        let manifest = readManifest(targetPath);

        // If no manifest exists yet, create a minimal one
        if (!manifest) {
            manifest = {
                alcopsVersion: 'unknown',
                alExtensionVersion: 'unknown',
                downloadedAt: new Date().toISOString(),
                targetFramework: 'unknown',
                files: [],
                pendingUpdate: true,
                pendingVersion: pendingVersion,
            };
        } else {
            manifest.pendingUpdate = true;
            manifest.pendingVersion = pendingVersion;
        }

        writeManifest(targetPath, manifest);
        console.log(`Marked ALCops v${pendingVersion} as pending for next startup`);
    } catch (error) {
        console.warn(`Failed to mark pending update: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Get pending update version if one exists
 */
export function getPendingUpdate(targetPath: string): string | null {
    try {
        const manifest = readManifest(targetPath);
        console.log(`getPendingUpdate: manifest exists=${!!manifest}, pendingUpdate=${manifest?.pendingUpdate}, version=${manifest?.pendingVersion}`);
        if (manifest?.pendingUpdate && manifest?.pendingVersion) {
            return manifest.pendingVersion;
        }
    } catch (error) {
        console.warn(`Failed to get pending update: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
}

/**
 * Clear pending update flag
 */
export function clearPendingUpdate(targetPath: string): void {
    try {
        const manifest = readManifest(targetPath);
        if (manifest) {
            manifest.pendingUpdate = false;
            manifest.pendingVersion = undefined;
            writeManifest(targetPath, manifest);
        }
    } catch (error) {
        console.warn(`Failed to clear pending update: ${error instanceof Error ? error.message : String(error)}`);
    }
}
