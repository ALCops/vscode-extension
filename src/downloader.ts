import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { unzipSync } from 'fflate';
import * as vscode from 'vscode';
import { compare, prerelease, valid } from 'semver';
import { getTargetFrameworkFromAssembly } from './dotnet-parser.js';
import { readManifest, writeManifest, createManifest, markAsPendingUpdate, clearPendingUpdate } from './manifest-manager.js';
import { checkDirectoryForLockedFiles } from './file-lock-handler.js';
import { stageAndReplaceFiles, cleanupOldBackups } from './file-staging.js';
import { getALExtension, promptUserForLockedFiles } from './al-extension-handler.js';
import { launchNewVSCodeWindow } from './vscode-launcher.js';
import { formatError, showTimedMessage } from './utils.js';

const PACKAGE_NAME = 'ALCops.Analyzers';

class InstallationMutex {
    private isLocked = false;
    private queue: Array<() => void> = [];

    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        if (this.isLocked) {
            await new Promise<void>((resolve) => this.queue.push(resolve));
        }
        this.isLocked = true;
        try {
            return await fn();
        } finally {
            const next = this.queue.shift();
            if (next) { next(); } else { this.isLocked = false; }
        }
    }
}

const installationMutex = new InstallationMutex();

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

        const missingFiles = manifest.files.filter(
            (file: string) => !fs.existsSync(path.join(targetPath, file))
        );

        if (missingFiles.length > 0) {
            return { isValid: false, missingFiles, reason: `Missing ${missingFiles.length} file(s)` };
        }

        return { isValid: true, missingFiles: [] };
    } catch (error) {
        return { isValid: false, missingFiles: [], reason: `Verification error: ${formatError(error)}` };
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
        const indexUrl = `https://api.nuget.org/v3-flatcontainer/${PACKAGE_NAME.toLowerCase()}/index.json`;
        const versions = await queryNuGetIndex(indexUrl);

        const filtered = versions
            .filter(v => valid(v) !== null)
            .filter(v => {
                const pre = prerelease(v);
                switch (channel) {
                    case 'stable': return pre === null;
                    case 'beta': return pre === null || !pre.includes('alpha');
                    case 'alpha': return true;
                    default: return false;
                }
            });

        if (filtered.length === 0) {
            return null;
        }

        return filtered.sort((a, b) => compare(a, b)).at(-1)!;
    } catch (error) {
        console.error('Error querying NuGet for latest version:', error);
        return null;
    }
}

function httpsGetWithRedirects(
    url: string,
    callback: (response: http.IncomingMessage) => void,
    onError: (err: Error) => void
): void {
    https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) { httpsGetWithRedirects(redirectUrl, callback, onError); return; }
        }
        callback(response);
    }).on('error', onError);
}

function queryNuGetIndex(indexUrl: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        httpsGetWithRedirects(indexUrl, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to query NuGet index. Status: ${response.statusCode}`));
                return;
            }
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data).versions || []);
                } catch (error) {
                    reject(new Error(`Failed to parse NuGet index response: ${formatError(error)}`));
                }
            });
        }, reject);
    });
}

export async function downloadALCopsAnalyzers(version: string): Promise<void> {
    // Use mutex to ensure only one installation at a time - prevents race conditions
    return installationMutex.withLock(() => downloadALCopsAnalyzersInternal(version));
}

/**
 * Internal implementation (wrapped by mutex)
 */
async function downloadALCopsAnalyzersInternal(version: string): Promise<void> {
    const downloadUrl = `https://www.nuget.org/api/v2/package/${PACKAGE_NAME}/${version}`;
    let tempDir: string | null = null;

    try {
        const alExtension = getALExtension();
        if (!alExtension) {
            throw new Error('AL extension (ms-dynamics-smb.al) is not installed');
        }

        const targetPath = path.join(alExtension.extensionPath, 'bin', 'Analyzers');
        fs.mkdirSync(targetPath, { recursive: true });

        // Download and extract to a temp directory
        tempDir = path.join(os.tmpdir(), `alcops-temp-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        const packagePath = path.join(tempDir, `${PACKAGE_NAME}.nupkg`);
        await downloadFile(downloadUrl, packagePath);

        const extractTempPath = path.join(tempDir, 'extracted');
        fs.mkdirSync(extractTempPath, { recursive: true });
        await extractZip(packagePath, extractTempPath);

        // Resolve which lib folder to use based on the AL extension's target framework
        const targetFramework = await getTargetFramework(targetPath);
        const libFolderName = findMatchingLibFolder(extractTempPath, targetFramework);

        if (!libFolderName) {
            throw new Error(`No matching lib folder found for target framework: ${targetFramework}`);
        }

        const sourceLibPath = path.join(extractTempPath, 'lib', libFolderName);
        if (!fs.existsSync(sourceLibPath)) {
            throw new Error(`Source lib folder not found: ${sourceLibPath}`);
        }

        if (await handleLockedFiles(targetPath, version) === 'deferred') { return; }

        // Stage files with rollback capability
        const stagingResult = stageAndReplaceFiles(sourceLibPath, targetPath);
        if (!stagingResult.success) {
            const newLockCheck = checkDirectoryForLockedFiles(targetPath);
            if (newLockCheck.isLocked) {
                throw new Error(`Cannot replace locked files: ${newLockCheck.lockedFiles.join(', ')}. Please reload VS Code to release the locks.`);
            }
            throw new Error(stagingResult.reason ?? 'Failed to stage and replace files');
        }

        // Update metadata
        const manifest = createManifest(version, alExtension.packageJSON.version, targetFramework, sourceLibPath);
        writeManifest(targetPath, manifest);
        clearPendingUpdate(targetPath);
        cleanupOldBackups(targetPath);
    } finally {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                console.warn(`Failed to clean up temp directory: ${err}`);
            }
        }
    }
}

async function handleLockedFiles(targetPath: string, version: string): Promise<'proceed' | 'deferred'> {
    const lockCheck = checkDirectoryForLockedFiles(targetPath);
    if (!lockCheck.isLocked) { return 'proceed'; }

    console.warn(`Locked files detected: ${lockCheck.lockedFiles.join(', ')}`);
    const userChoice = await promptUserForLockedFiles(targetPath, version);

    if (userChoice === 'cancel') {
        throw new Error('Installation cancelled by user due to locked files');
    }

    if (userChoice === 'defer') {
        markAsPendingUpdate(targetPath, version);
        showTimedMessage(`ALCops v${version} will be installed on next VS Code startup.`);
        return 'deferred';
    }

    if (userChoice === 'close-relaunch') {
        markAsPendingUpdate(targetPath, version);
        launchNewVSCodeWindow();
        await vscode.commands.executeCommand('workbench.action.closeWindow');
        return 'deferred';
    }

    return 'proceed';
}

/**
 * Download a file from a URL
 */
function downloadFile(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);
        const cleanup = (err: Error) => { file.destroy(); fs.unlink(filePath, () => { }); reject(err); };
        httpsGetWithRedirects(url, (response) => {
            if (response.statusCode !== 200) {
                file.destroy();
                reject(new Error(`Failed to download file. Status: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
            file.on('error', cleanup);
        }, cleanup);
    });
}

/**
 * Extract a zip file to a directory
 */
function extractZip(zipPath: string, extractPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const data = fs.readFileSync(zipPath);
            const entries = unzipSync(new Uint8Array(data));
            for (const [entryPath, content] of Object.entries(entries)) {
                const destPath = path.join(extractPath, entryPath);
                if (entryPath.endsWith('/')) {
                    fs.mkdirSync(destPath, { recursive: true });
                } else {
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.writeFileSync(destPath, content);
                }
            }
            resolve();
        } catch (error) {
            reject(error);
        }
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
        throw new Error(`Failed to read target framework from DLL: ${formatError(error)}`);
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
