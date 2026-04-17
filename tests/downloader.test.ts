import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { findMatchingLibFolder } from '../src/downloader.js';

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
