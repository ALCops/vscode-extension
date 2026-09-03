// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { VersionManager } from './version-manager.js';
import { AutoUpdater } from './auto-updater.js';
import { StatusBarManager } from './status-bar-manager.js';
import { initLogger, log } from './logger.js';
import { gatherVersionInfo, formatClipboardText, formatVersionBanner } from './version-info.js';
import { showTimedMessage } from './utils.js';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Create the "ALCops" output channel before anything logs
	initLogger(context);
	log.info(`ALCops is now active. ${formatVersionBanner(gatherVersionInfo())}`);

	// Initialize version manager and auto updater first; StatusBarManager subscribes to its event
	const versionManager = new VersionManager(context);
	const autoUpdater = new AutoUpdater(versionManager);

	// Log the resulting versions after every successful installation
	const installLogDisposable = autoUpdater.onDidInstallAnalyzers((version) => {
		log.info(`Installed ALCops.Analyzers v${version}. ${formatVersionBanner(gatherVersionInfo())}`);
	});

	// Initialize status bar manager and wire up the installation event
	const statusBarManager = new StatusBarManager(context, autoUpdater.onDidInstallAnalyzers);

	// Perform all startup checks (pending updates, reinstallation, auto-updates)
	await autoUpdater.performStartupChecks();

	// Register the check updates command
	const checkUpdatesDisposable = vscode.commands.registerCommand('alcops.checkUpdates', async () => {
		try {
			await autoUpdater.checkUpdatesManually();
		} catch (error) {
			log.error('Check updates command failed:', error);
		}
	});

	// Register the install command
	const installDisposable = vscode.commands.registerCommand('alcops.install', async () => {
		try {
			await autoUpdater.installLatestVersion();
		} catch (error) {
			log.error('Install update command failed:', error);
		}
	});

	// Register the copy version information command
	const copyVersionInfoDisposable = vscode.commands.registerCommand('alcops.copyVersionInfo', async () => {
		try {
			await vscode.env.clipboard.writeText(formatClipboardText(gatherVersionInfo()));
			showTimedMessage('ALCops version information copied to clipboard.');
		} catch (error) {
			log.error('Copy version information command failed:', error);
		}
	});

	context.subscriptions.push(
		statusBarManager,
		autoUpdater,
		installLogDisposable,
		checkUpdatesDisposable,
		installDisposable,
		copyVersionInfoDisposable
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
