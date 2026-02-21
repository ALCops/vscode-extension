import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

function isSnapEnvironment(): boolean {
    return !!process.env['SNAP'] || !!process.env['SNAP_NAME'];
}

function isFlatpakEnvironment(): boolean {
    return !!process.env['FLATPAK_ID'] || fs.existsSync('/.flatpak-info');
}

/**
 * Returns the CLI command name for the current VS Code variant.
 * Uses vscode.env.uriScheme: 'vscode' -> 'code', 'vscode-insiders' -> 'code-insiders'.
 */
function getCliName(): string {
    return vscode.env.uriScheme.replace('vscode', 'code');
}

/**
 * Launch a new empty VS Code window (no workspace/folder).
 *
 * Platform strategy:
 * - Remote sessions (SSH, WSL, containers): shows a warning. process.execPath points to the
 *   server-side binary and cannot open a local window.
 * - macOS: uses `open -n -g -a <app-bundle>` to avoid dock/activation/focus issues.
 *   The .app bundle path is derived from vscode.env.appRoot which is more reliable than
 *   process.execPath (which points into the .app bundle, not at it).
 * - Snap / Flatpak: spawns the PATH-based CLI name so sandbox constraints are respected.
 * - Windows / standard Linux: spawns process.execPath directly.
 *   CRITICAL: ELECTRON_RUN_AS_NODE must be deleted from the environment. The extension host
 *   sets this flag, which causes the Electron binary to behave as a plain Node.js process
 *   instead of launching VS Code.
 */
export function launchNewVSCodeWindow(): void {
    if (vscode.env.remoteName) {
        vscode.window.showWarningMessage(
            'Cannot open a new VS Code window from a remote session. Please restart VS Code manually.'
        );
        return;
    }

    if (process.platform === 'darwin') {
        // appRoot: /Applications/Visual Studio Code.app/Contents/Resources/app
        // bundle:  /Applications/Visual Studio Code.app
        const appBundle = path.join(vscode.env.appRoot, '..', '..', '..');
        spawn('open', ['-n', '-g', '-a', appBundle, '--args', '--new-window'], {
            detached: true,
            stdio: 'ignore',
        }).unref();
        return;
    }

    if (isSnapEnvironment() || isFlatpakEnvironment()) {
        spawn(getCliName(), ['--new-window'], {
            detached: true,
            stdio: 'ignore',
            shell: true,
        }).unref();
        return;
    }

    // Windows and standard Linux installs
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    env['ELECTRON_NO_ATTACH_CONSOLE'] = '1';

    spawn(process.execPath, ['--new-window'], {
        detached: true,
        stdio: 'ignore',
        env,
    }).unref();
}
