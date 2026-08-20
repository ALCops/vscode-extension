import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveAnalyzersDir, getAnalyzersDirCandidates, CODE_ANALYSIS_DLL } from '../src/analyzers-layout.js';

describe('resolveAnalyzersDir', () => {
    let tempDir: string;
    let binPath: string;
    let legacyPath: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcops-layout-test-'));
        binPath = path.join(tempDir, 'bin');
        legacyPath = path.join(binPath, 'Analyzers');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function placeDll(dir: string): void {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, CODE_ANALYSIS_DLL), 'stub');
    }

    it('returns bin for the flat layout (AL 18+)', () => {
        placeDll(binPath);
        expect(resolveAnalyzersDir(tempDir)).toBe(binPath);
    });

    it('returns bin/Analyzers for the legacy layout (AL <=17)', () => {
        placeDll(legacyPath);
        expect(resolveAnalyzersDir(tempDir)).toBe(legacyPath);
    });

    it('prefers the flat layout when the DLL exists in both locations', () => {
        placeDll(binPath);
        placeDll(legacyPath);
        expect(resolveAnalyzersDir(tempDir)).toBe(binPath);
    });

    it('returns bin when an empty Analyzers folder exists alongside a flat DLL', () => {
        // Real-world AL 18 state: an empty bin/Analyzers left behind by older installs
        placeDll(binPath);
        fs.mkdirSync(legacyPath, { recursive: true });
        expect(resolveAnalyzersDir(tempDir)).toBe(binPath);
    });

    it('returns null when the DLL exists in neither location', () => {
        fs.mkdirSync(legacyPath, { recursive: true });
        expect(resolveAnalyzersDir(tempDir)).toBeNull();
    });

    it('returns null when the bin folder does not exist', () => {
        expect(resolveAnalyzersDir(tempDir)).toBeNull();
    });
});

describe('getAnalyzersDirCandidates', () => {
    it('probes flat bin first, then legacy bin/Analyzers', () => {
        const root = path.join('C:', 'ext', 'al');
        expect(getAnalyzersDirCandidates(root)).toEqual([
            path.join(root, 'bin'),
            path.join(root, 'bin', 'Analyzers'),
        ]);
    });
});
