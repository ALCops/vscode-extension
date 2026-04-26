import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
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

function getUserAgent(): string {
    const extension = vscode.extensions.getExtension('arthurvdv.alcops');
    const version = extension?.packageJSON?.version ?? '0.0.0';
    return `NuGet VS VSIX/${version} (Node.js ${process.version}; ${os.type()} ${os.release()})`;
}

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
        const registrationVersions = await queryNuGetRegistration(PACKAGE_NAME);

        const filtered = registrationVersions
            .filter(v => v.listed)
            .filter(v => valid(v.version) !== null)
            .filter(v => {
                const pre = prerelease(v.version);
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

        return filtered.sort((a, b) => compare(a.version, b.version)).at(-1)!.version;
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
    https.get(url, { headers: { 'User-Agent': getUserAgent() } }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) { httpsGetWithRedirects(redirectUrl, callback, onError); return; }
        }
        callback(response);
    }).on('error', onError);
}

export interface RegistrationVersion {
    version: string;
    listed: boolean;
    packageContent: string;
}

interface RegistrationCatalogEntry {
    version: string;
    listed?: boolean;
}

interface RegistrationLeaf {
    catalogEntry: RegistrationCatalogEntry;
    packageContent: string;
}

interface RegistrationPage {
    '@id': string;
    items?: RegistrationLeaf[];
}

export interface RegistrationIndex {
    items: RegistrationPage[];
}

/**
 * Fetches a URL and returns parsed JSON, handling gzip decompression when the
 * server responds with `Content-Encoding: gzip`. Used for NuGet V3 Registration
 * API requests which are always gzip-compressed in the `-gz-semver2` hive.
 */
function fetchJsonWithGzip<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        httpsGetWithRedirects(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }

            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => { chunks.push(chunk); });
            response.on('end', () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    const isGzip = response.headers['content-encoding'] === 'gzip';
                    const text = isGzip ? zlib.gunzipSync(buffer).toString('utf-8') : buffer.toString('utf-8');
                    resolve(JSON.parse(text) as T);
                } catch (error) {
                    reject(new Error(`Failed to parse response from ${url}: ${formatError(error)}`));
                }
            });
        }, reject);
    });
}

/**
 * Parses a NuGet V3 Registration index response into a flat list of versions.
 * Handles the nested page/leaf/catalogEntry structure. All pages must have their
 * items inlined (external pages should be resolved before calling this function).
 */
export function parseRegistrationIndex(json: RegistrationIndex): RegistrationVersion[] {
    const versions: RegistrationVersion[] = [];
    for (const page of json.items) {
        if (page.items) {
            for (const leaf of page.items) {
                versions.push({
                    version: leaf.catalogEntry.version,
                    listed: leaf.catalogEntry.listed ?? true,
                    packageContent: leaf.packageContent,
                });
            }
        }
    }
    return versions;
}

/**
 * Queries the NuGet V3 Registration API for package versions with metadata.
 *
 * Uses the `registration5-gz-semver2` hive which includes SemVer 2.0.0 packages
 * and provides listing status per version. The response is gzip-compressed.
 *
 * For packages with <128 versions, all page data is inlined in the index response.
 * For packages with 128+ versions, pages are external references that must be
 * fetched separately. External pages are fetched in parallel.
 */
export async function queryNuGetRegistration(packageId: string): Promise<RegistrationVersion[]> {
    const registrationUrl = `https://api.nuget.org/v3/registration5-gz-semver2/${packageId.toLowerCase()}/index.json`;
    const index = await fetchJsonWithGzip<RegistrationIndex>(registrationUrl);

    const externalPages = index.items.filter(page => !page.items);
    if (externalPages.length > 0) {
        const fetched = await Promise.all(
            externalPages.map(page => fetchJsonWithGzip<RegistrationPage>(page['@id']))
        );
        for (let i = 0; i < externalPages.length; i++) {
            externalPages[i].items = fetched[i].items;
        }
    }

    return parseRegistrationIndex(index);
}

export async function downloadALCopsAnalyzers(version: string): Promise<void> {
    // Use mutex to ensure only one installation at a time - prevents race conditions
    return installationMutex.withLock(() => downloadALCopsAnalyzersInternal(version));
}

/**
 * Internal implementation (wrapped by mutex)
 */
async function downloadALCopsAnalyzersInternal(version: string): Promise<void> {
    const lowerPackageName = PACKAGE_NAME.toLowerCase();
    const lowerVersion = version.toLowerCase();
    const downloadUrl = `https://api.nuget.org/v3-flatcontainer/${lowerPackageName}/${lowerVersion}/${lowerPackageName}.${lowerVersion}.nupkg`;
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

    const frameworkName = await getTargetFrameworkFromAssembly(dllFile);
    if (!frameworkName) {
        throw new Error(`Could not determine target framework from: ${dllFile}`);
    }
    return frameworkName;
}

/**
 * Find the matching lib folder that corresponds to the target framework
 */
export function findMatchingLibFolder(extractedPackagePath: string, targetFramework: string): string | null {
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

    // netstandard fallback: accept a higher minor version (e.g., netstandard2.1 for netstandard2.0)
    if (targetFramework.startsWith('netstandard')) {
        const match = targetFramework.match(/^netstandard(\d+)\.(\d+)$/);
        if (match) {
            const major = parseInt(match[1]);
            const minor = parseInt(match[2]);
            let bestCandidate: string | null = null;
            let bestMinor = Infinity;

            for (const folder of folders) {
                const fm = folder.match(/^netstandard(\d+)\.(\d+)$/);
                if (!fm) { continue; }
                const fMajor = parseInt(fm[1]);
                const fMinor = parseInt(fm[2]);
                if (fMajor === major && fMinor > minor && fMinor < bestMinor) {
                    bestMinor = fMinor;
                    bestCandidate = folder;
                }
            }

            if (bestCandidate) {
                return bestCandidate;
            }
        }
    }

    return null;
}
