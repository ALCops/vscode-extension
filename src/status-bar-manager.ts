import * as vscode from 'vscode';
import * as path from 'path';
import { CodeAnalyzersManager } from './code-analyzers-manager.js';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];
    private codeAnalyzersManager: CodeAnalyzersManager | null = null;

    constructor(context: vscode.ExtensionContext) {
        // Create status bar item on the left side, before the language mode
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100 // High priority to show it early
        );

        // Initialize Code Analyzers Manager with AL extension path
        try {
            const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
            if (alExtension) {
                const analyzerPath = path.join(alExtension.extensionPath, 'bin', 'Analyzers');
                this.codeAnalyzersManager = new CodeAnalyzersManager(analyzerPath);
            } else {
                // Initialize with default analyzers
                this.codeAnalyzersManager = new CodeAnalyzersManager('');
            }
        } catch (error) {
            // Initialize with default analyzers even if error occurs
            this.codeAnalyzersManager = new CodeAnalyzersManager('');
        }

        // Register the select command
        const selectDisposable = vscode.commands.registerCommand(
            'alcops.selectCodeAnalyzers',
            () => this.selectCodeAnalyzers()
        );

        // Listen for active editor changes to update status bar
        const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(
            () => this.updateStatusBar()
        );

        // Listen for configuration changes
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
            (event) => {
                if (event.affectsConfiguration('al.codeAnalyzers')) {
                    this.updateStatusBar();
                }
            }
        );

        this.disposables.push(selectDisposable, editorChangeDisposable, configChangeDisposable);
        context.subscriptions.push(...this.disposables);

        // Initial status bar update
        this.updateStatusBar();
    }

    /**
     * Updates the status bar display with the count of active Code Analyzers
     */
    private updateStatusBar(): void {
        const activeCodeAnalyzersCount = this.getActiveCodeAnalyzersCount();

        this.statusBarItem.text = `AL Cops: ${activeCodeAnalyzersCount}`;
        this.statusBarItem.command = 'alcops.selectCodeAnalyzers';
        this.statusBarItem.tooltip = `Click to select Code Analyzers (${activeCodeAnalyzersCount} active)`;
        this.statusBarItem.show();
    }

    /**
     * Get the current URI for configuration (prioritizes active editor)
     */
    private getCurrentFileUri(): vscode.Uri | undefined {
        if (vscode.window.activeTextEditor) {
            return vscode.window.activeTextEditor.document.uri;
        }
        return undefined;
    }

    /**
     * Get the configuration target that's currently being used
     */
    private getCurrentConfigTarget(): vscode.ConfigurationTarget {
        const uri = this.getCurrentFileUri();
        const currentAnalyzerSettings = vscode.workspace.getConfiguration('al', uri).inspect('codeAnalyzers');

        // Priority: WorkspaceFolder > Workspace > Global
        if (currentAnalyzerSettings?.workspaceFolderValue) {
            return vscode.ConfigurationTarget.WorkspaceFolder;
        }
        if (currentAnalyzerSettings?.workspaceValue) {
            return vscode.ConfigurationTarget.Workspace;
        }
        return vscode.ConfigurationTarget.Global;
    }

    /**
     * Count the number of active Code Analyzers
     */
    private getActiveCodeAnalyzersCount(): number {
        if (!this.codeAnalyzersManager) {
            // Should not happen, but default to 0 as fallback
            console.warn('CodeAnalyzersManager not initialized');
            return 0;
        }

        const uri = this.getCurrentFileUri();
        const codeAnalyzers = vscode.workspace.getConfiguration('al', uri).get<string | string[]>('codeAnalyzers', '');

        // Handle both string and array formats
        const activeAnalyzers = Array.isArray(codeAnalyzers)
            ? codeAnalyzers
            : (codeAnalyzers as string).split(',').map(a => a.trim()).filter(a => a);

        // Use CodeAnalyzersManager to count active analyzers (excluding Common library)
        return this.codeAnalyzersManager.countActiveCodeAnalyzers(activeAnalyzers);
    }

    /**
     * Check if a specific Code Analyzer is currently enabled
     */
    private isCodeAnalyzerEnabled(analyzer: { setting: string }): boolean {
        const uri = this.getCurrentFileUri();
        const codeAnalyzers = vscode.workspace.getConfiguration('al', uri).get<string | string[]>('codeAnalyzers', '');

        // Handle both string and array formats
        const activeAnalyzers = Array.isArray(codeAnalyzers)
            ? codeAnalyzers
            : (codeAnalyzers as string).split(',').map(a => a.trim()).filter(a => a);

        return activeAnalyzers.includes(analyzer.setting);
    }

    /**
     * Show quick-pick menu to select which Code Analyzers to enable/disable
     */
    private async selectCodeAnalyzers(): Promise<void> {
        if (!this.codeAnalyzersManager) {
            vscode.window.showErrorMessage('Code Analyzers manager not initialized');
            return;
        }

        const availableCops = this.codeAnalyzersManager.getAvailableCodeAnalyzers();

        const uri = this.getCurrentFileUri();
        const alConfig = vscode.workspace.getConfiguration('al', uri);
        const currentAnalyzersRaw = alConfig.get<string | string[]>('codeAnalyzers', '');
        const configTarget = this.getCurrentConfigTarget();

        // Handle both string and array formats
        const currentAnalyzers = Array.isArray(currentAnalyzersRaw)
            ? currentAnalyzersRaw
            : (currentAnalyzersRaw as string).split(',').map(a => a.trim()).filter(a => a);

        // Create quick-pick items with current state
        const quickPickItems = availableCops.map(cop => ({
            label: cop.label,
            description: cop.description,
            setting: cop.setting,
            picked: this.isCodeAnalyzerEnabled(cop)
        }));

        // Show quick-pick menu
        const selectedCops = await vscode.window.showQuickPick(quickPickItems, {
            canPickMany: true,
            placeHolder: 'Select which Code Analyzers to enable',
            title: 'AL Code Analyzers Configuration'
        });

        if (selectedCops === undefined) {
            // User cancelled
            return;
        }

        // Process selected cops using CodeAnalyzersManager
        const selectedCopObjects = selectedCops.map(selected =>
            availableCops.find(cop => cop.setting === selected.setting)!
        );

        const newAnalyzers = this.codeAnalyzersManager.processSelectedAnalyzers(selectedCopObjects, currentAnalyzers);

        try {
            await alConfig.update('codeAnalyzers', newAnalyzers, configTarget);
            const count = selectedCops.length;
            const message = count === 0
                ? 'All Code Analyzers have been disabled.'
                : `Selected ${count} Code Analyzer${count === 1 ? '' : 's'}.`;
            vscode.window.showInformationMessage(message);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update Code Analyzers: ${error}`);
            console.error('Error updating Code Analyzers:', error);
        }

        this.updateStatusBar();
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.statusBarItem.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
