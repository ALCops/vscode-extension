import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;

/**
 * Create the "ALCops" output channel and register it for disposal.
 * Call this first thing during activation, before anything logs.
 */
export function initLogger(context: vscode.ExtensionContext): vscode.LogOutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('ALCops', { log: true });
        context.subscriptions.push(outputChannel);
    }
    return outputChannel;
}

/**
 * Logging facade used across the extension.
 *
 * Writes to the "ALCops" output channel once {@link initLogger} has run, and
 * falls back to the console otherwise. The fallback keeps pure-Node modules
 * importable in unit tests, where no VS Code window exists.
 */
export const log = {
    info(message: string, ...args: unknown[]): void {
        if (outputChannel) {
            outputChannel.info(message, ...args);
        } else {
            console.log(message, ...args);
        }
    },

    warn(message: string, ...args: unknown[]): void {
        if (outputChannel) {
            outputChannel.warn(message, ...args);
        } else {
            console.warn(message, ...args);
        }
    },

    error(message: string | Error, ...args: unknown[]): void {
        if (outputChannel) {
            outputChannel.error(message, ...args);
        } else {
            console.error(message, ...args);
        }
    },

    debug(message: string, ...args: unknown[]): void {
        if (outputChannel) {
            outputChannel.debug(message, ...args);
        } else {
            console.debug(message, ...args);
        }
    },
};
