import { promises as fs } from 'node:fs';

const ATTRIBUTE_NAME = 'TargetFrameworkAttribute';

const TFM_PREFIXES = [
    '.NETCoreApp,Version=v',
    '.NETStandard,Version=v',
    '.NETFramework,Version=v',
] as const;

const VERSION_CHAR_REGEX = /^[0-9.]+/;

/**
 * Extract the Target Framework Moniker from a compiled .NET assembly (.dll)
 * by scanning the binary for the TargetFrameworkAttribute metadata string.
 *
 * Uses only Buffer.indexOf() (native C++ byte scan) for performance on large files.
 * Does not execute the assembly or require the .NET runtime.
 *
 * @returns Short TFM (e.g. "net8.0", "netstandard2.1") or null if not found.
 */
export async function getTargetFrameworkFromAssembly(dllPath: string): Promise<string | null> {
    let buffer: Buffer;
    try {
        buffer = await fs.readFile(dllPath);
    } catch {
        return null;
    }

    if (buffer.indexOf(ATTRIBUTE_NAME, 0, 'utf8') === -1) {
        return null;
    }

    for (const prefix of TFM_PREFIXES) {
        const idx = buffer.indexOf(prefix, 0, 'utf8');
        if (idx === -1) { continue; }

        // Extract version digits from the bytes immediately after the prefix
        const versionStart = idx + Buffer.byteLength(prefix, 'utf8');
        const slice = buffer.subarray(versionStart, Math.min(versionStart + 16, buffer.length));
        const versionStr = slice.toString('utf8');

        const match = VERSION_CHAR_REGEX.exec(versionStr);
        if (!match) { continue; }

        const version = match[0].replace(/\.+$/, '');
        if (version.length === 0) { continue; }

        const fullTfm = `${prefix}${version}`;
        return toShortTfm(fullTfm);
    }

    return null;
}

/**
 * Convert a canonical framework moniker to the short TFM form used by the .NET SDK.
 *
 * Examples:
 *   ".NETCoreApp,Version=v8.0"     → "net8.0"
 *   ".NETStandard,Version=v2.1"    → "netstandard2.1"
 *   ".NETFramework,Version=v4.8"   → "net4.8"
 */
export function toShortTfm(tfm: string | null): string | null {
    if (!tfm) { return null; }
    return tfm
        .replace('.NETCoreApp,Version=v', 'net')
        .replace('.NETStandard,Version=v', 'netstandard')
        .replace('.NETFramework,Version=v', 'net');
}
