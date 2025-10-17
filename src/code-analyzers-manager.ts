import { readManifest } from './manifest-manager.js';

export interface CodeAnalyzerInfo {
    label: string;
    setting: string;
    description: string;
    fileName: string;
    isCommon: boolean;
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
            isCommon: false
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
                isCommon: false
            },
            {
                label: 'UICop',
                setting: '${UICop}',
                description: 'Web client customization rules',
                fileName: 'UICop.dll',
                isCommon: false
            },
            {
                label: 'PerTenantExtensionCop',
                setting: '${PerTenantExtensionCop}',
                description: 'Per-tenant extension installation rules',
                fileName: 'PerTenantExtensionCop.dll',
                isCommon: false
            },
            {
                label: 'AppSourceCop',
                setting: '${AppSourceCop}',
                description: 'AppSource marketplace publishing requirementss',
                fileName: 'AppSourceCop.dll',
                isCommon: false
            }
        ];
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
     * Check if an analyzer is currently enabled in the list
     */
    isCodeAnalyzerEnabled(analyzer: CodeAnalyzerInfo, activeAnalyzers: string[]): boolean {
        return activeAnalyzers.includes(analyzer.setting);
    }

    /**
     * Process the new list of selected analyzers and add Common library if needed
     * Only add Common.dll when custom ALCops (from manifest) are selected
     */
    processSelectedAnalyzers(selectedAnalyzers: CodeAnalyzerInfo[], currentAnalyzers: string[]): string[] {
        const defaultAnalyzers = this.getDefaultCodeAnalyzers();

        // Custom analyzers are anything in analyzersList that's not in defaultAnalyzers
        const customAnalyzers = this.analyzersList.filter(analyzer =>
            !defaultAnalyzers.some(d => d.setting === analyzer.setting)
        );

        // Get non-Code Analyzer analyzers (remove ALL Code Analyzers: both default and custom)
        const nonCodeAnalyzerAnalyzers = currentAnalyzers.filter(analyzer => {
            // Remove default AL Code Analyzers
            const isDefaultAnalyzer = defaultAnalyzers.some(ca => ca.setting === analyzer);
            // Remove custom Code Analyzers from manifest
            const isCustomAnalyzer = customAnalyzers.some(ca => ca.setting === analyzer);
            // Remove common library
            const isCommonLib = analyzer === this.getCommonLibrarySetting();

            // Keep only analyzers that are NOT any of these
            return !isDefaultAnalyzer && !isCustomAnalyzer && !isCommonLib;
        });

        // Add selected analyzer settings
        const selectedSettings = selectedAnalyzers.map(analyzer => analyzer.setting);

        // Check if any CUSTOM analyzer is selected
        const hasCustomAnalyzerSelected = selectedAnalyzers.some(analyzer =>
            customAnalyzers.some(custom => custom.setting === analyzer.setting)
        );

        // Only add the common library if a custom analyzer is selected
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
     * Count active Code Analyzers (excluding Common library)
     */
    countActiveCodeAnalyzers(activeAnalyzers: string[]): number {
        return this.analyzersList.filter(analyzer =>
            activeAnalyzers.includes(analyzer.setting)
        ).length;
    }
}
