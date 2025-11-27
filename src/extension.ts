// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { VersionManager } from './version-manager.js';
import { AutoUpdater } from './auto-updater.js';
import { StatusBarManager } from './status-bar-manager.js';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ALCops" is now active!');

	// Initialize status bar manager
	const statusBarManager = new StatusBarManager(context);

	// Initialize version manager and auto updater
	const versionManager = new VersionManager(context);
	const autoUpdater = new AutoUpdater(versionManager);

	// Perform all startup checks (pending updates, reinstallation, auto-updates)
	await autoUpdater.performStartupChecks();

	// Register the check updates command
	const checkUpdatesDisposable = vscode.commands.registerCommand('alcops.checkUpdates', async () => {
		try {
			await autoUpdater.checkUpdatesManually();
		} catch (error) {
			console.error('Check updates command failed:', error);
		}
	});

	// Register the install command
	const installDisposable = vscode.commands.registerCommand('alcops.install', async () => {
		try {
			await autoUpdater.installLatestVersion();
		} catch (error) {
			console.error('Install update command failed:', error);
		}
	});

	context.subscriptions.push(
		checkUpdatesDisposable,
		installDisposable
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
