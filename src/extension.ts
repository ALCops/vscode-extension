// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { VersionManager } from './version-manager.js';
import { AutoUpdater } from './auto-updater.js';
import { getPendingUpdate, clearPendingUpdate } from './manifest-manager.js';
import { downloadALCopsAnalyzers } from './downloader.js';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "alcops" is now active!');

	// Initialize version manager and auto updater
	const versionManager = new VersionManager(context);
	const autoUpdater = new AutoUpdater(versionManager);

	// Check for pending updates from previous deferred installations
	let pendingInstallationCompleted = false;
	try {
		const alExtension = vscode.extensions.getExtension('ms-dynamics-smb.al');
		if (alExtension) {
			const analyzerPath = path.join(alExtension.extensionPath, 'bin', 'Analyzers');
			const pendingVersion = getPendingUpdate(analyzerPath);

			console.log(`Pending version check: ${pendingVersion ? `Found v${pendingVersion}` : 'No pending installation'}`);

			if (pendingVersion) {
				console.log(`Found pending ALCops installation for version ${pendingVersion}. Attempting installation...`);
				try {
					await downloadALCopsAnalyzers(pendingVersion, versionManager);
					console.log(`Pending installation of ALCops v${pendingVersion} completed successfully.`);
					pendingInstallationCompleted = true;
					vscode.window.showInformationMessage(`ALCops v${pendingVersion} has been successfully installed!`);
				} catch (error) {
					console.error(`Failed to install pending ALCops update: ${error}`);
					console.log(`Pending flag will be retained for next startup retry`);
				}
			}
		}
	} catch (error) {
		console.warn('Error checking for pending updates:', error);
	}

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
			const versionChannel = vscode.workspace.getConfiguration('alcops').get<string>('versionChannel', 'stable') as 'stable' | 'beta' | 'alpha';
			const { queryLatestVersion } = await import('./downloader.js');
			const latestVersion = await queryLatestVersion(versionChannel);

			if (latestVersion) {
				await autoUpdater.installUpdate(latestVersion);
			} else {
				vscode.window.showErrorMessage('Could not determine latest ALCops version');
			}
		} catch (error) {
			console.error('Install update command failed:', error);
		}
	});

	// Only trigger auto-update check if we didn't just complete a pending installation
	if (!pendingInstallationCompleted) {
		autoUpdater.checkAndNotifyUpdates().catch((error) => {
			console.error('Auto-update check failed:', error);
		});
	}

	context.subscriptions.push(
		checkUpdatesDisposable,
		installDisposable
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
