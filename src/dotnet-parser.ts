import { promises as fs } from 'node:fs';
import * as PEStruct from 'pe-struct';

/**
 * Reads the assembly version from a .NET assembly and determines the target framework.
 * 
 * Version logic:
 * - Version <= 16.0.21.53261: use netstandard2.1
 * - Version > 16.0.21.53261: use net8.0
 */
export async function getTargetFrameworkFromAssembly(dllPath: string): Promise<string> {
    try {
        const buf = await fs.readFile(dllPath);
        // Convert Buffer to ArrayBuffer for pe-struct
        const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        const pe = PEStruct.load(arrayBuffer);

        // Access the Assembly metadata table
        if (!pe?.mdtAssembly?.values || pe.mdtAssembly.values.length === 0) {
            throw new Error('No Assembly metadata table found');
        }

        const asm = pe.mdtAssembly.values[0];

        // Extract version components from Assembly table
        const major = asm.MajorVersion.value ?? 0;
        const minor = asm.MinorVersion.value ?? 0;
        const build = asm.BuildNumber.value ?? 0;
        const rev = asm.RevisionNumber.value ?? 0;

        const versionString = `${major}.${minor}.${build}.${rev}`;

        // Compare version: if <= 16.0.21.53261, use netstandard2.1; otherwise use net8.0
        return compareVersion(versionString, '16.0.21.53261') <= 0 ? 'netstandard2.1' : 'net8.0';
    } catch (error) {
        throw new Error(`Failed to parse assembly: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function compareVersion(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(x => parseInt(x, 10));
    const v2Parts = version2.split('.').map(x => parseInt(x, 10));

    const maxLength = Math.max(v1Parts.length, v2Parts.length);
    for (let i = 0; i < maxLength; i++) {
        const v1 = v1Parts[i] || 0;
        const v2 = v2Parts[i] || 0;
        if (v1 > v2) return 1;
        if (v1 < v2) return -1;
    }
    return 0;
}
