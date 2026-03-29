import { readManifest } from './manifest-manager.js';

export interface CodeAnalyzerInfo {
    label: string;
    setting: string;
    description: string;
    fileName: string;
    source: 'default' | 'alcops' | 'thirdparty';
}

/**
 * Manages Code Analyzers discovery and configuration from the manifest
 */
export class CodeAnalyzersManager {
    private manifestPath: string;
    private analyzersList: CodeAnalyzerInfo[] = [];

    constructor(analyzerPath: string) {
        this.manifestPath = analyzerPath;
        this.loadCodeAnalyzers();
    }

    /**
     * Load Code Analyzers from the manifest file
     */
    private loadCodeAnalyzers(): void {
        // Always start with the default AL Code Analyzers
        const defaultAnalyzers = this.getDefaultCodeAnalyzers();

        const manifest = readManifest(this.manifestPath);

        if (!manifest || !manifest.files || manifest.files.length === 0) {
            this.analyzersList = defaultAnalyzers;
            return;
        }

        // Filter out the common library
        const analyzerFiles = manifest.files.filter(file => !this.isCommonLibrary(file));

        // Convert file names to CodeAnalyzerInfo
        const customAnalyzers = analyzerFiles.map(file => this.fileNameToCodeAnalyzerInfo(file));

        // Combine default analyzers with custom analyzers from manifest
        this.analyzersList = [...defaultAnalyzers, ...customAnalyzers];
    }

    /**
     * Check if a file is the common library
     */
    private isCommonLibrary(fileName: string): boolean {
        return fileName.toLowerCase() === 'alcops.common.dll';
    }

    /**
     * Convert a file name to CodeAnalyzerInfo
     */
    private fileNameToCodeAnalyzerInfo(fileName: string): CodeAnalyzerInfo {
        // Remove 'ALCops.' prefix and '.dll' suffix
        const cleanName = fileName
            .replace(/^ALCops\./, '')
            .replace(/\.dll$/, '');

        return {
            label: cleanName,
            setting: `\${analyzerFolder}${fileName}`,
            fileName: fileName,
            description: `${cleanName} analyzer from ALCops`,
            source: 'alcops',
        };
    }

    /**
     * Get default Code Analyzers for fallback (if manifest not available)
     */
    private getDefaultCodeAnalyzers(): CodeAnalyzerInfo[] {
        return [
            {
                label: 'CodeCop',
                setting: '${CodeCop}',
                description: 'AL coding guidelines and best practices',
                fileName: 'ApplicationCop.dll',
                source: 'default',
            },
            {
                label: 'UICop',
                setting: '${UICop}',
                description: 'Web client customization rules',
                fileName: 'UICop.dll',
                source: 'default',
            },
            {
                label: 'PerTenantExtensionCop',
                setting: '${PerTenantExtensionCop}',
                description: 'Per-tenant extension installation rules',
                fileName: 'PerTenantExtensionCop.dll',
                source: 'default',
            },
            {
                label: 'AppSourceCop',
                setting: '${AppSourceCop}',
                description: 'AppSource marketplace publishing requirements',
                fileName: 'AppSourceCop.dll',
                source: 'default',
            }
        ];
    }

    /**
     * Reload Code Analyzers from the manifest file.
     * Call this after new analyzers have been downloaded.
     */
    refresh(): void {
        this.analyzersList = [];
        this.loadCodeAnalyzers();
    }

    /**
     * Get all available Code Analyzers
     */
    getAvailableCodeAnalyzers(): CodeAnalyzerInfo[] {
        return this.analyzersList;
    }

    /**
     * Get the Common library setting
     */
    getCommonLibrarySetting(): string {
        return '${analyzerFolder}ALCops.Common.dll';
    }

    /**
     * Discover third-party analyzers from the current al.codeAnalyzers setting.
     * Any entry that is not a known analyzer (defaults, ALCops manifest, Common library)
     * is treated as a third-party analyzer.
     */
    discoverThirdPartyAnalyzers(activeAnalyzers: string[]): CodeAnalyzerInfo[] {
        const commonLibrary = this.getCommonLibrarySetting();
        const knownSettings = new Set([
            ...this.analyzersList.map(a => a.setting),
            commonLibrary,
        ]);

        return activeAnalyzers
            .filter(entry => !knownSettings.has(entry))
            .map(entry => this.parseThirdPartyAnalyzer(entry));
    }

    /**
     * Parse a third-party analyzer setting string into CodeAnalyzerInfo
     */
    private parseThirdPartyAnalyzer(setting: string): CodeAnalyzerInfo {
        let fileName: string;
        let label: string;

        // Handle ${analyzerFolder}Name.dll format
        const analyzerFolderMatch = setting.match(/^\$\{analyzerFolder\}(.+)$/);
        if (analyzerFolderMatch) {
            fileName = analyzerFolderMatch[1];
            label = fileName.replace(/\.dll$/i, '');
        } else {
            // Handle full/relative paths or plain names
            const segments = setting.replace(/\\/g, '/').split('/');
            fileName = segments[segments.length - 1];
            label = fileName.replace(/\.dll$/i, '') || setting;
        }

        return {
            label,
            setting,
            description: 'Third-party analyzer (detected from settings)',
            fileName,
            source: 'thirdparty',
        };
    }

    /**
     * Check if an analyzer is currently enabled in the list
     */
    isCodeAnalyzerEnabled(analyzer: CodeAnalyzerInfo, activeAnalyzers: string[]): boolean {
        return activeAnalyzers.includes(analyzer.setting);
    }

    /**
     * Process the new list of selected analyzers and add Common library if needed
     * Only add Common.dll when custom ALCops (from manifest) are selected
     */
    processSelectedAnalyzers(selectedAnalyzers: CodeAnalyzerInfo[], currentAnalyzers: string[], thirdPartyAnalyzers: CodeAnalyzerInfo[] = []): string[] {
        const defaultAnalyzers = this.getDefaultCodeAnalyzers();

        // Custom analyzers are anything in analyzersList that's not in defaultAnalyzers
        const customAnalyzers = this.analyzersList.filter(analyzer =>
            !defaultAnalyzers.some(d => d.setting === analyzer.setting)
        );

        // Get non-Code Analyzer analyzers (remove ALL known analyzers: default, custom, third-party)
        const nonCodeAnalyzerAnalyzers = currentAnalyzers.filter(analyzer => {
            // Remove default AL Code Analyzers
            const isDefaultAnalyzer = defaultAnalyzers.some(ca => ca.setting === analyzer);
            // Remove custom Code Analyzers from manifest
            const isCustomAnalyzer = customAnalyzers.some(ca => ca.setting === analyzer);
            // Remove common library
            const isCommonLib = analyzer === this.getCommonLibrarySetting();
            // Remove third-party analyzers (so deselection actually removes them)
            const isThirdParty = thirdPartyAnalyzers.some(tp => tp.setting === analyzer);

            // Keep only analyzers that are NOT any of these
            return !isDefaultAnalyzer && !isCustomAnalyzer && !isCommonLib && !isThirdParty;
        });

        // Add selected analyzer settings
        const selectedSettings = selectedAnalyzers.map(analyzer => analyzer.setting);

        // Check if any ALCops analyzer is selected (not third-party)
        const hasCustomAnalyzerSelected = selectedAnalyzers.some(analyzer =>
            customAnalyzers.some(custom => custom.setting === analyzer.setting)
        );

        // Only add the common library if an ALCops analyzer is selected
        if (hasCustomAnalyzerSelected) {
            const commonLibrary = this.getCommonLibrarySetting();
            if (!selectedSettings.includes(commonLibrary)) {
                selectedSettings.push(commonLibrary);
            }
        }

        const result = [...nonCodeAnalyzerAnalyzers, ...selectedSettings];
        return result;
    }

    /**
     * Count active Code Analyzers
     */
    countActiveCodeAnalyzers(activeAnalyzers: string[]): number {
        const commonLibrarySetting = this.getCommonLibrarySetting();
        // Count all active analyzers except the Common library
        return activeAnalyzers.filter(analyzer => analyzer !== commonLibrarySetting).length;
    }
}
