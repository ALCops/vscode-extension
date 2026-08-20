import * as fs from 'fs';
import * as path from 'path';

/**
 * The AL compiler DLL used to detect both the analyzers folder layout
 * and the target .NET framework of the AL Language extension.
 */
export const CODE_ANALYSIS_DLL = 'Microsoft.Dynamics.Nav.CodeAnalysis.dll';

/**
 * Resolve the directory where analyzer DLLs live inside the AL Language extension.
 *
 * AL 18+ (BC 29) ships a flat layout: all DLLs (including the compiler and
 * Microsoft analyzers) sit directly in `bin/`. AL <=17 uses the legacy layout
 * with a `bin/Analyzers/` subfolder.
 *
 * Detection probes for Microsoft.Dynamics.Nav.CodeAnalysis.dll, flat layout
 * first. This is unambiguous: legacy versions never place the DLL directly in
 * `bin/`, and probing avoids brittle version thresholds or folder-existence
 * checks (an empty `bin/Analyzers/` folder may exist on flat layouts).
 *
 * @param alExtensionPath Root path of the installed AL Language extension
 * @returns The directory containing the CodeAnalysis DLL, or null if not found
 */
export function resolveAnalyzersDir(alExtensionPath: string): string | null {
    for (const candidate of getAnalyzersDirCandidates(alExtensionPath)) {
        if (fs.existsSync(path.join(candidate, CODE_ANALYSIS_DLL))) {
            return candidate;
        }
    }
    return null;
}

/**
 * Candidate analyzer directories in probe order: flat `bin/` (AL 18+) first,
 * legacy `bin/Analyzers/` (AL <=17) as fallback.
 */
export function getAnalyzersDirCandidates(alExtensionPath: string): string[] {
    const binPath = path.join(alExtensionPath, 'bin');
    return [binPath, path.join(binPath, 'Analyzers')];
}
