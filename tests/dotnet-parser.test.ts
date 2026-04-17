import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { getTargetFrameworkFromAssembly, toShortTfm } from '../src/dotnet-parser.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('getTargetFrameworkFromAssembly', () => {
    it('returns net8.0 for a .NET 8 assembly', async () => {
        const dll = path.join(fixturesDir, 'compiler-net80', 'Microsoft.Dynamics.Nav.CodeAnalysis.dll');
        const result = await getTargetFrameworkFromAssembly(dll);
        expect(result).toBe('net8.0');
    });

    it('returns netstandard2.1 for a .NET Standard 2.1 assembly', async () => {
        const dll = path.join(fixturesDir, 'compiler-netstandard21', 'Microsoft.Dynamics.Nav.CodeAnalysis.dll');
        const result = await getTargetFrameworkFromAssembly(dll);
        expect(result).toBe('netstandard2.1');
    });

    it('returns null for a non-existent file', async () => {
        const result = await getTargetFrameworkFromAssembly('/non/existent/path.dll');
        expect(result).toBeNull();
    });

    it('returns null for a non-.NET file', async () => {
        const tmpFile = path.join(fixturesDir, 'not-a-dll.txt');
        fs.writeFileSync(tmpFile, 'This is not a .NET assembly');
        try {
            const result = await getTargetFrameworkFromAssembly(tmpFile);
            expect(result).toBeNull();
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });
});

describe('toShortTfm', () => {
    it('converts .NETCoreApp to net prefix', () => {
        expect(toShortTfm('.NETCoreApp,Version=v8.0')).toBe('net8.0');
    });

    it('converts .NETStandard to netstandard prefix', () => {
        expect(toShortTfm('.NETStandard,Version=v2.1')).toBe('netstandard2.1');
    });

    it('converts .NETFramework to net prefix', () => {
        expect(toShortTfm('.NETFramework,Version=v4.8')).toBe('net4.8');
    });

    it('returns null for null input', () => {
        expect(toShortTfm(null)).toBeNull();
    });
});
