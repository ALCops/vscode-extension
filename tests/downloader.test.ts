import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => ({
    extensions: {
        getExtension: () => ({ packageJSON: { version: '0.0.0-test' } }),
    },
}));

const mockHttpsGet = vi.fn();
vi.mock('https', () => ({
    get: (...args: unknown[]) => mockHttpsGet(...args),
}));

import { findMatchingLibFolder, parseRegistrationIndex, queryNuGetRegistration } from '../src/downloader.js';
import type { RegistrationIndex } from '../src/downloader.js';

describe('findMatchingLibFolder', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcops-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function createLibFolders(...folders: string[]): void {
        const libPath = path.join(tempDir, 'lib');
        fs.mkdirSync(libPath, { recursive: true });
        for (const folder of folders) {
            fs.mkdirSync(path.join(libPath, folder), { recursive: true });
        }
    }

    it('returns null when lib folder does not exist', () => {
        expect(findMatchingLibFolder(tempDir, 'net8.0')).toBeNull();
    });

    it('returns direct match when available', () => {
        createLibFolders('net8.0', 'netstandard2.1');
        expect(findMatchingLibFolder(tempDir, 'net8.0')).toBe('net8.0');
    });

    it('returns direct match for netstandard when available', () => {
        createLibFolders('netstandard2.0', 'netstandard2.1');
        expect(findMatchingLibFolder(tempDir, 'netstandard2.0')).toBe('netstandard2.0');
    });

    it('falls back to netstandard2.1 when target is netstandard2.0', () => {
        createLibFolders('netstandard2.1', 'net8.0');
        expect(findMatchingLibFolder(tempDir, 'netstandard2.0')).toBe('netstandard2.1');
    });

    it('picks the lowest higher netstandard minor version', () => {
        createLibFolders('netstandard2.1', 'netstandard2.3');
        expect(findMatchingLibFolder(tempDir, 'netstandard2.0')).toBe('netstandard2.1');
    });

    it('does not match a lower netstandard minor version', () => {
        createLibFolders('netstandard2.0');
        expect(findMatchingLibFolder(tempDir, 'netstandard2.1')).toBeNull();
    });

    it('does not match a different netstandard major version', () => {
        createLibFolders('netstandard3.0');
        expect(findMatchingLibFolder(tempDir, 'netstandard2.0')).toBeNull();
    });

    it('returns null for netstandard target when only net* folders exist', () => {
        createLibFolders('net8.0');
        expect(findMatchingLibFolder(tempDir, 'netstandard2.0')).toBeNull();
    });

    it('falls back to lower net* version for net targets', () => {
        createLibFolders('net8.0');
        expect(findMatchingLibFolder(tempDir, 'net9.0')).toBe('net8.0');
    });

    it('falls back to netstandard2.1 for net targets when no net* match', () => {
        createLibFolders('netstandard2.1');
        expect(findMatchingLibFolder(tempDir, 'net8.0')).toBe('netstandard2.1');
    });
});

function makeRegistrationIndex(
    leaves: Array<{ version: string; listed?: boolean; packageContent?: string }>
): RegistrationIndex {
    return {
        items: [{
            '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/index.json#page/0',
            items: leaves.map(l => ({
                catalogEntry: {
                    version: l.version,
                    listed: l.listed,
                },
                packageContent: l.packageContent ??
                    `https://api.nuget.org/v3-flatcontainer/test/${l.version.toLowerCase()}/test.${l.version.toLowerCase()}.nupkg`,
            })),
        }],
    };
}

describe('parseRegistrationIndex', () => {
    it('extracts versions from inlined page items', () => {
        const index = makeRegistrationIndex([
            { version: '1.0.0', listed: true },
            { version: '2.0.0', listed: true },
        ]);
        const result = parseRegistrationIndex(index);
        expect(result).toHaveLength(2);
        expect(result[0].version).toBe('1.0.0');
        expect(result[1].version).toBe('2.0.0');
    });

    it('preserves listing status', () => {
        const index = makeRegistrationIndex([
            { version: '1.0.0', listed: true },
            { version: '1.1.0-alpha.1', listed: false },
        ]);
        const result = parseRegistrationIndex(index);
        expect(result[0].listed).toBe(true);
        expect(result[1].listed).toBe(false);
    });

    it('defaults listed to true when undefined', () => {
        const index = makeRegistrationIndex([
            { version: '1.0.0', listed: undefined },
        ]);
        const result = parseRegistrationIndex(index);
        expect(result[0].listed).toBe(true);
    });

    it('extracts packageContent URLs', () => {
        const url = 'https://api.nuget.org/v3-flatcontainer/test/1.0.0/test.1.0.0.nupkg';
        const index = makeRegistrationIndex([
            { version: '1.0.0', listed: true, packageContent: url },
        ]);
        const result = parseRegistrationIndex(index);
        expect(result[0].packageContent).toBe(url);
    });

    it('skips pages without inlined items', () => {
        const index: RegistrationIndex = {
            items: [
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/0',
                },
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/1',
                    items: [{
                        catalogEntry: { version: '2.0.0', listed: true },
                        packageContent: 'https://example.com/test.2.0.0.nupkg',
                    }],
                },
            ],
        };
        const result = parseRegistrationIndex(index);
        expect(result).toHaveLength(1);
        expect(result[0].version).toBe('2.0.0');
    });

    it('handles multiple pages with inlined items', () => {
        const index: RegistrationIndex = {
            items: [
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/0',
                    items: [
                        { catalogEntry: { version: '1.0.0', listed: true }, packageContent: 'https://example.com/1' },
                    ],
                },
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/1',
                    items: [
                        { catalogEntry: { version: '2.0.0', listed: false }, packageContent: 'https://example.com/2' },
                    ],
                },
            ],
        };
        const result = parseRegistrationIndex(index);
        expect(result).toHaveLength(2);
        expect(result[0].version).toBe('1.0.0');
        expect(result[1].version).toBe('2.0.0');
    });

    it('returns empty array for empty index', () => {
        const index: RegistrationIndex = { items: [] };
        expect(parseRegistrationIndex(index)).toEqual([]);
    });
});

/**
 * Creates a mock HTTP response emitter that emits the given JSON body,
 * optionally gzip-compressed, as a stream.
 */
function createMockResponse(
    body: unknown,
    options: { gzip?: boolean; statusCode?: number } = {}
): EventEmitter & { statusCode: number; headers: Record<string, string> } {
    const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
    };
    response.statusCode = options.statusCode ?? 200;
    const json = JSON.stringify(body);
    const useGzip = options.gzip ?? true;
    response.headers = useGzip ? { 'content-encoding': 'gzip' } : {};

    // Emit data on next tick so the caller can attach listeners first
    process.nextTick(() => {
        const buf = Buffer.from(json, 'utf-8');
        response.emit('data', useGzip ? zlib.gzipSync(buf) : buf);
        response.emit('end');
    });

    return response;
}

describe('queryNuGetRegistration', () => {
    afterEach(() => {
        mockHttpsGet.mockReset();
    });

    it('returns versions from a fully-inlined index', async () => {
        const indexBody: RegistrationIndex = {
            items: [{
                '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/index.json#page/0',
                items: [
                    {
                        catalogEntry: { version: '1.0.0', listed: true },
                        packageContent: 'https://api.nuget.org/v3-flatcontainer/test/1.0.0/test.1.0.0.nupkg',
                    },
                    {
                        catalogEntry: { version: '2.0.0', listed: false },
                        packageContent: 'https://api.nuget.org/v3-flatcontainer/test/2.0.0/test.2.0.0.nupkg',
                    },
                ],
            }],
        };

        mockHttpsGet.mockImplementation((_url: unknown, _opts: unknown, cb: unknown) => {
            (cb as (r: unknown) => void)(createMockResponse(indexBody));
            const req = new EventEmitter();
            return Object.assign(req, { on: vi.fn().mockReturnThis() });
        });

        const result = await queryNuGetRegistration('Test');
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            version: '1.0.0', listed: true,
            packageContent: 'https://api.nuget.org/v3-flatcontainer/test/1.0.0/test.1.0.0.nupkg',
        });
        expect(result[1].listed).toBe(false);
    });

    it('fetches external pages and merges results', async () => {
        const indexBody = {
            items: [
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/1.0.0/1.9.9.json',
                    count: 1,
                    lower: '1.0.0',
                    upper: '1.9.9',
                    // No items — external page
                },
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/2.0.0/2.9.9.json',
                    count: 1,
                    lower: '2.0.0',
                    upper: '2.9.9',
                    // No items — external page
                },
            ],
        };

        const page0Body = {
            '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/1.0.0/1.9.9.json',
            items: [{
                catalogEntry: { version: '1.0.0', listed: true },
                packageContent: 'https://api.nuget.org/v3-flatcontainer/test/1.0.0/test.1.0.0.nupkg',
            }],
        };

        const page1Body = {
            '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/2.0.0/2.9.9.json',
            items: [{
                catalogEntry: { version: '2.0.0', listed: true },
                packageContent: 'https://api.nuget.org/v3-flatcontainer/test/2.0.0/test.2.0.0.nupkg',
            }],
        };

        const responses: Record<string, unknown> = {
            'https://api.nuget.org/v3/registration5-gz-semver2/test/index.json': indexBody,
            'https://api.nuget.org/v3/registration5-gz-semver2/test/page/1.0.0/1.9.9.json': page0Body,
            'https://api.nuget.org/v3/registration5-gz-semver2/test/page/2.0.0/2.9.9.json': page1Body,
        };

        mockHttpsGet.mockImplementation((url: unknown, _opts: unknown, cb: unknown) => {
            const body = responses[url as string];
            if (!body) {
                throw new Error(`Unexpected URL: ${url}`);
            }
            (cb as (r: unknown) => void)(createMockResponse(body));
            const req = new EventEmitter();
            return Object.assign(req, { on: vi.fn().mockReturnThis() });
        });

        const result = await queryNuGetRegistration('Test');
        expect(result).toHaveLength(2);
        expect(result[0].version).toBe('1.0.0');
        expect(result[1].version).toBe('2.0.0');
    });

    it('handles mix of inlined and external pages', async () => {
        const indexBody = {
            items: [
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/index.json#page/0',
                    items: [{
                        catalogEntry: { version: '1.0.0', listed: true },
                        packageContent: 'https://api.nuget.org/v3-flatcontainer/test/1.0.0/test.1.0.0.nupkg',
                    }],
                },
                {
                    '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/test/page/2.0.0/2.9.9.json',
                    count: 1,
                    lower: '2.0.0',
                    upper: '2.9.9',
                },
            ],
        };

        const externalPageBody = {
            items: [{
                catalogEntry: { version: '2.0.0', listed: false },
                packageContent: 'https://api.nuget.org/v3-flatcontainer/test/2.0.0/test.2.0.0.nupkg',
            }],
        };

        const responses: Record<string, unknown> = {
            'https://api.nuget.org/v3/registration5-gz-semver2/test/index.json': indexBody,
            'https://api.nuget.org/v3/registration5-gz-semver2/test/page/2.0.0/2.9.9.json': externalPageBody,
        };

        mockHttpsGet.mockImplementation((url: unknown, _opts: unknown, cb: unknown) => {
            const body = responses[url as string];
            if (!body) {
                throw new Error(`Unexpected URL: ${url}`);
            }
            (cb as (r: unknown) => void)(createMockResponse(body));
            const req = new EventEmitter();
            return Object.assign(req, { on: vi.fn().mockReturnThis() });
        });

        const result = await queryNuGetRegistration('Test');
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            version: '1.0.0', listed: true,
            packageContent: 'https://api.nuget.org/v3-flatcontainer/test/1.0.0/test.1.0.0.nupkg',
        });
        expect(result[1]).toEqual({
            version: '2.0.0', listed: false,
            packageContent: 'https://api.nuget.org/v3-flatcontainer/test/2.0.0/test.2.0.0.nupkg',
        });
    });

    it('lowercases the package ID in the registration URL', async () => {
        const indexBody: RegistrationIndex = {
            items: [{
                '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/mypackage/index.json#page/0',
                items: [{
                    catalogEntry: { version: '1.0.0', listed: true },
                    packageContent: 'https://api.nuget.org/v3-flatcontainer/mypackage/1.0.0/mypackage.1.0.0.nupkg',
                }],
            }],
        };

        let capturedUrl = '';
        mockHttpsGet.mockImplementation((url: unknown, _opts: unknown, cb: unknown) => {
            capturedUrl = url as string;
            (cb as (r: unknown) => void)(createMockResponse(indexBody));
            const req = new EventEmitter();
            return Object.assign(req, { on: vi.fn().mockReturnThis() });
        });

        await queryNuGetRegistration('MyPackage');
        expect(capturedUrl).toBe('https://api.nuget.org/v3/registration5-gz-semver2/mypackage/index.json');
    });

    it('rejects when index fetch returns non-200 status', async () => {
        mockHttpsGet.mockImplementation((_url: unknown, _opts: unknown, cb: unknown) => {
            (cb as (r: unknown) => void)(createMockResponse({}, { statusCode: 404, gzip: false }));
            const req = new EventEmitter();
            return Object.assign(req, { on: vi.fn().mockReturnThis() });
        });

        await expect(queryNuGetRegistration('nonexistent')).rejects.toThrow('HTTP 404');
    });
});
