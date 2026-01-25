import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as unzipper from 'unzipper';
import * as vscode from 'vscode';
import { getTargetFrameworkFromAssembly } from './dotnet-parser';
import { readManifest, writeManifest, deleteManifest, createManifest, ALCopsManifest, markAsPendingUpdate, clearPendingUpdate, getPendingUpdate } from './manifest-manager';
import { checkDirectoryForLockedFiles } from './file-lock-handler';
import { stageAndReplaceFiles, cleanupOldBackups } from './file-staging';
import { checkALExtensionStatus, promptUserForLockedFiles, showLockedFilesError } from './al-extension-handler';
import { installationMutex } from './installation-mutex.js';

const PACKAGE_NAME = 'ALCops.Analyzers';

/**
 * Result of verifying analyzer installation
 */
export interface VerificationResult {
    isValid: boolean;
    missingFiles: string[];
    reason?: string;
}

/**
 * Verify if the analyzer installation at the target path is valid and complete
 */
export function verifyAnalyzerInstallation(targetPath: string): VerificationResult {
    try {
        const manifest = readManifest(targetPath);

        if (!manifest) {
            return {
                isValid: false,
                missingFiles: [],
                reason: 'No manifest file found',
            };
        }

        const missingFiles: string[] = [];

        // Check if all files in manifest exist
        for (const file of manifest.files) {
            const filePath = path.join(targetPath, file);
            if (!fs.existsSync(filePath)) {
                missingFiles.push(file);
            }
        }

        if (missingFiles.length > 0) {
            return {
                isValid: false,
                missingFiles,
                reason: `Missing ${missingFiles.length} file(s)`,
            };
        }

        return {
            isValid: true,
            missingFiles: [],
        };
    } catch (error) {
        return {
            isValid: false,
            missingFiles: [],
            reason: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Query the latest version from NuGet based on the specified release channel
 * 
 * Channel behavior:
 * - stable: Only versions without pre-release suffix (e.g., 1.0.0)
 * - beta: Stable + beta versions (e.g., 1.0.0, 1.0.0-beta.1)
 * - alpha: All versions including alpha pre-releases
 */
export async function queryLatestVersion(channel: 'stable' | 'beta' | 'alpha'): Promise<string | null> {
    try {
        // Query NuGet API for all versions
        const indexUrl = `https://api.nuget.org/v3-flatcontainer/${PACKAGE_NAME.toLowerCase()}/index.json`;
        const versions = await queryNuGetIndex(indexUrl);

        if (!versions || versions.length === 0) {
            return null;
        }

        // Filter versions based on channel
        const filtered = versions.filter((version) => {
            const lowerVersion = version.toLowerCase();

            switch (channel) {
                case 'stable':
                    // Stable versions have no pre-release suffix
                    return !lowerVersion.includes('-');
                case 'beta':
                    // Beta channel includes stable and beta versions (not alpha)
                    return !lowerVersion.includes('-alpha');
                case 'alpha':
                    // Alpha channel includes all versions
                    return true;
                default:
                    return false;
            }
        });

        if (filtered.length === 0) {
            return null;
        }

        // Sort and return the latest version
        const sorted = filtered.sort(compareSemVer);
        return sorted[sorted.length - 1];
    } catch (error) {
        console.error('Error querying NuGet for latest version:', error);
        return null;
    }
}

/**
 * Query the NuGet API index to get all available versions
 */
function queryNuGetIndex(indexUrl: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        https.get(indexUrl, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    queryNuGetIndex(redirectUrl).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to query NuGet index. Status: ${response.statusCode}`));
                return;
            }

            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const versions = json.versions || [];
                    resolve(versions);
                } catch (error) {
                    reject(new Error(`Failed to parse NuGet index response: ${error instanceof Error ? error.message : String(error)}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Parse a semver version string into components for comparison
 */
function parseSemVer(version: string): { major: number; minor: number; patch: number; prerelease: string | null; prereleaseNum: number } {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(?:\.?(\d+))?)?$/);
    if (!match) {
        return { major: 0, minor: 0, patch: 0, prerelease: null, prereleaseNum: 0 };
    }

    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        prerelease: match[4]?.toLowerCase() || null,
        prereleaseNum: match[5] ? parseInt(match[5], 10) : 0
    };
}

/**
 * Compare two semver versions
 * Returns negative if a < b, positive if a > b, 0 if equal
 * Pre-release versions are considered lower than their release counterpart
 * (e.g., 1.0.0-beta.10 < 1.0.0)
 */
function compareSemVer(a: string, b: string): number {
    const verA = parseSemVer(a);
    const verB = parseSemVer(b);

    // Compare major.minor.patch
    if (verA.major !== verB.major) return verA.major - verB.major;
    if (verA.minor !== verB.minor) return verA.minor - verB.minor;
    if (verA.patch !== verB.patch) return verA.patch - verB.patch;

    // If one has prerelease and other doesn't, release version wins
    if (verA.prerelease === null && verB.prerelease !== null) return 1;
    if (verA.prerelease !== null && verB.prerelease === null) return -1;
    if (verA.prerelease === null && verB.prerelease === null) return 0;

    // Both have prerelease - compare prerelease type (alpha < beta)
    const prereleaseOrder: { [key: string]: number } = { 'alpha': 1, 'beta': 2 };
    const orderA = prereleaseOrder[verA.prerelease!] || 0;
    const orderB = prereleaseOrder[verB.prerelease!] || 0;

    if (orderA !== orderB) return orderA - orderB;

    // Same prerelease type - compare prerelease number
    return verA.prereleaseNum - verB.prereleaseNum;
}

export async function downloadALCopsAnalyzers(version?: string, versionManager?: any): Promise<void> {
    // Use mutex to ensure only one installation at a time - prevents race conditions
    return installationMutex.withLock(async () => {
        return await downloadALCopsAnalyzersInternal(version, versionManager);
    });
}

/**
 * Internal implementation (wrapped by mutex)
 */
async function downloadALCopsAnalyzersInternal(version?: string, versionManager?: any): Promise<void> {
    const packageName = PACKAGE_NAME;
    const downloadUrl = version
        ? `https://www.nuget.org/api/v2/package/${packageName}/${version}`
        : `https://www.nuget.org/api/v2/package/${packageName}`;

    let tempDir: string | null = null;
    let targetPath: string | null = null;
    let alExtensionUpdated = false;
    let filesWereMissing = false;

    try {
        const displayVersion = version ? ` (v${version})` : '';
        vscode.window.showInformationMessage(`Downloading ${packageName}${displayVersion}...`);

        // Get the AL extension
        const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
        if (!alExtension) {
            throw new Error('AL extension (ms-dynamics-smb.al) is not installed');
        }

        // Check if AL extension has been updated
        if (versionManager) {
            alExtensionUpdated = versionManager.hasALExtensionChanged(alExtension);
            if (alExtensionUpdated) {
                console.log('AL extension has been updated. Clearing old metadata.');
                deleteManifest(path.join(alExtension.extensionPath, 'bin', 'Analyzers'));
            }
        }

        // Set target path to the AL extension's Analyzers folder
        targetPath = path.join(alExtension.extensionPath, 'bin', 'Analyzers');
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }

        // Verify existing installation if not forcing a new download
        if (!alExtensionUpdated && !version) {
            const verification = verifyAnalyzerInstallation(targetPath);
            if (verification.isValid) {
                vscode.window.showInformationMessage(`${packageName} is already installed and valid.`);
                return;
            }
            if (!verification.isValid && verification.reason) {
                filesWereMissing = true;
            }
        }

        // Create a temporary directory for the download using the system temp folder
        tempDir = path.join(os.tmpdir(), 'alcops-temp-' + Date.now());
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Download the NuGet package
        const packagePath = path.join(tempDir, `${packageName}.nupkg`);
        await downloadFile(downloadUrl, packagePath);

        // Extract the entire package to a temporary extraction directory first
        const extractTempPath = path.join(tempDir, 'extracted');
        if (!fs.existsSync(extractTempPath)) {
            fs.mkdirSync(extractTempPath, { recursive: true });
        }
        await extractZip(packagePath, extractTempPath);

        // Determine which lib folder to use based on the target framework
        const targetFramework = await getTargetFramework(targetPath);
        const libFolderName = findMatchingLibFolder(extractTempPath, targetFramework);

        if (!libFolderName) {
            throw new Error(`No matching lib folder found for target framework: ${targetFramework}`);
        }

        const sourceLibPath = path.join(extractTempPath, 'lib', libFolderName);
        if (!fs.existsSync(sourceLibPath)) {
            throw new Error(`Source lib folder not found: ${sourceLibPath}`);
        }

        // Check for locked files before attempting replacement
        const lockCheckResult = checkDirectoryForLockedFiles(targetPath);
        if (lockCheckResult.isLocked) {
            console.warn(`Locked files detected: ${lockCheckResult.lockedFiles.join(', ')}`);

            // Prompt user for action
            const userChoice = await promptUserForLockedFiles(targetPath, version || 'latest');

            if (userChoice === 'defer') {
                // Mark as pending update and inform user
                markAsPendingUpdate(targetPath, version || 'latest');
                vscode.window.showInformationMessage(
                    `Installation of ALCops${displayVersion} scheduled for next VS Code startup. Some files are currently locked by the AL extension.`,
                    'Reload Now'
                ).then((result) => {
                    if (result === 'Reload Now') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                });
                return;
            } else if (userChoice === 'cancel') {
                throw new Error('Installation cancelled by user due to locked files');
            }
            // If 'reload', continue with installation attempt
        }

        // Use staging to safely replace files with rollback capability
        const stagingResult = stageAndReplaceFiles(sourceLibPath, targetPath);

        if (!stagingResult.success) {
            // Check if it's a lock issue
            const newLockCheck = checkDirectoryForLockedFiles(targetPath);
            if (newLockCheck.isLocked) {
                console.error(`Installation failed due to locked files: ${newLockCheck.lockedFiles.join(', ')}`);
                throw new Error(`Cannot replace locked files: ${newLockCheck.lockedFiles.join(', ')}. Please reload VS Code to release the locks.`);
            }
            throw new Error(stagingResult.reason || 'Failed to stage and replace files');
        }

        // Determine the downloaded version for the manifest
        const manifestVersion = version || await queryLatestVersion('stable') || 'unknown';

        // Create and write manifest
        const alExtensionVersion = alExtension.packageJSON.version;
        const manifest = createManifest(
            manifestVersion,
            alExtensionVersion,
            targetFramework,
            sourceLibPath
        );
        writeManifest(targetPath, manifest);

        // Clear any pending update flag since installation succeeded
        clearPendingUpdate(targetPath);

        // Clean up old backup directories
        cleanupOldBackups(targetPath);

        // Clean up temporary files
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        // Provide context-aware success message
        let successMessage = `${packageName}${displayVersion} downloaded and extracted successfully!`;
        if (alExtensionUpdated) {
            successMessage = `AL extension updated detected. ${packageName}${displayVersion} reinstalled to new location.`;
        } else if (filesWereMissing) {
            successMessage = `${packageName}${displayVersion} recovered - missing files have been restored.`;
        }

        vscode.window.showInformationMessage(successMessage);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const displayVersion = version ? ` (v${version})` : '';
        const err = error instanceof Error ? error : new Error(String(error));

        // Show enhanced error message if it's a lock issue
        if (targetPath) {
            const lockCheck = checkDirectoryForLockedFiles(targetPath);
            if (lockCheck.isLocked) {
                await showLockedFilesError(err, targetPath);
            } else {
                vscode.window.showErrorMessage(`Failed to download ${packageName}${displayVersion}: ${errorMessage}`);
            }
        } else {
            vscode.window.showErrorMessage(`Failed to download ${packageName}${displayVersion}: ${errorMessage}`);
        }
        throw error;
    } finally {
        // Ensure temp directory is cleaned up on error
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                console.warn(`Failed to clean up temp directory: ${err}`);
            }
        }
    }
}

/**
 * Download a file from a URL
 */
function downloadFile(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);

        https.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 302 || response.statusCode === 301) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    file.destroy();
                    downloadFile(redirectUrl, filePath).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                file.destroy();
                reject(new Error(`Failed to download file. Status: ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close(() => {
                    resolve();
                });
            });

            file.on('error', (err) => {
                file.destroy();
                fs.unlink(filePath, () => { }); // Delete the file on error
                reject(err);
            });
        }).on('error', (err) => {
            file.destroy();
            fs.unlink(filePath, () => { }); // Delete the file on error
            reject(err);
        });
    });
}

/**
 * Extract a zip file to a directory
 */
function extractZip(zipPath: string, extractPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.createReadStream(zipPath)
            .pipe(unzipper.Extract({ path: extractPath }))
            .on('finish', () => {
                resolve();
            })
            .on('error', (err: Error) => {
                reject(err);
            });
    });
}

/**
 * Extract the target framework from the Microsoft.Dynamics.Nav.CodeAnalysis.dll file
 */
async function getTargetFramework(dllPath: string): Promise<string> {
    const dllFile = path.join(dllPath, 'Microsoft.Dynamics.Nav.CodeAnalysis.dll');

    if (!fs.existsSync(dllFile)) {
        throw new Error(`DLL file not found: ${dllFile}`);
    }

    try {
        // Use native .NET assembly parser to read metadata
        const frameworkName = await getTargetFrameworkFromAssembly(dllFile);
        return frameworkName;
    } catch (error) {
        throw new Error(`Failed to read target framework from DLL: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Find the matching lib folder that corresponds to the target framework
 */
function findMatchingLibFolder(extractedPackagePath: string, targetFramework: string): string | null {
    const libPath = path.join(extractedPackagePath, 'lib');

    if (!fs.existsSync(libPath)) {
        return null;
    }

    const folders = fs.readdirSync(libPath);

    // Direct match first
    if (folders.includes(targetFramework)) {
        return targetFramework;
    }

    // Try to find a compatible folder (for backward/forward compatibility)
    // E.g., if target is net8.0, try net8.0, net7.0, net6.0, etc., then netstandard versions
    if (targetFramework.startsWith('net') && !targetFramework.startsWith('netstandard')) {
        const version = parseInt(targetFramework.replace('net', ''));

        // Try higher versions first
        for (let v = version + 5; v >= 6; v--) {
            const candidate = `net${v}.0`;
            if (folders.includes(candidate)) {
                return candidate;
            }
        }

        // Try netstandard as fallback
        if (folders.includes('netstandard2.1')) {
            return 'netstandard2.1';
        }
    }

    return null;
}
