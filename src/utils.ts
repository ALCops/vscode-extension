import * as vscode from 'vscode';

/**
 * Format an unknown error value into a human-readable string
 */
export function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Show an informational notification that automatically dismisses after a timeout.
 * Intended for pure status messages that require no user action.
 * Uses the standard withProgress pattern so the toast closes on its own.
 *
 * @param message    The message to display.
 * @param timeoutMs  How long (ms) before the notification is dismissed. Defaults to 5000.
 */
export function showTimedMessage(message: string, timeoutMs = 5000): void {
    vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: message },
        () => new Promise<void>(resolve => setTimeout(resolve, timeoutMs))
    );
}
