import * as fs from 'fs';
import * as path from 'path';

/**
 * Result of staging and replacing files
 */
export interface StagingResult {
    success: boolean;
    replacedCount: number;
    failedFiles: string[];
    reason?: string;
}

/**
 * Stage files for replacement with rollback capability
 * Just backup, copy, and rollback on failure. Do this in a single pass to minimize the time window for race conditions
 */
export function stageAndReplaceFiles(
    sourceDir: string,
    targetDir: string
): StagingResult {
    const backupDir = path.join(targetDir, '.backup-' + Date.now());
    const failedFiles: string[] = [];
    const replacedFiles: string[] = [];

    try {
        // Step 1: Read files from source (only actual files, no directories)
        const sourceFiles = fs.readdirSync(sourceDir).filter(file => {
            const sourceFile = path.join(sourceDir, file);
            return fs.statSync(sourceFile).isFile();
        });

        if (sourceFiles.length === 0) {
            return {
                success: true,
                replacedCount: 0,
                failedFiles: [],
            };
        }

        // Step 2: Create backup directory
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        // Step 3: Backup and replace files in a single loop
        // This minimizes the time window where files are in an inconsistent state
        for (const file of sourceFiles) {
            const sourceFile = path.join(sourceDir, file);
            const targetFile = path.join(targetDir, file);
            const backupFile = path.join(backupDir, file);

            try {
                // Backup existing file if it exists
                if (fs.existsSync(targetFile)) {
                    fs.copyFileSync(targetFile, backupFile);
                }

                // Immediately copy new file to target
                // Using renameSync would be more atomic, but source is in a different directory
                fs.copyFileSync(sourceFile, targetFile);
                replacedFiles.push(file);
            } catch (error) {
                failedFiles.push(file);
                console.error(`Failed to replace file ${file}:`, error);
                // Don't continue - we want all-or-nothing
                break;
            }
        }

        // Step 4: If all operations succeeded, clean up backup
        if (failedFiles.length === 0) {
            fs.rmSync(backupDir, { recursive: true, force: true });
            return {
                success: true,
                replacedCount: replacedFiles.length,
                failedFiles: [],
            };
        }

        // Step 5: Rollback on partial failure
        console.warn(`Partial failure detected (${failedFiles.length}/${sourceFiles.length}). Rolling back...`);
        rollbackFiles(backupDir, targetDir);

        return {
            success: false,
            replacedCount: 0,
            failedFiles,
            reason: `Failed to replace ${failedFiles.length} file(s): ${failedFiles.join(', ')}`,
        };
    } catch (error) {
        // Clean up on catastrophic failure
        if (fs.existsSync(backupDir)) {
            fs.rmSync(backupDir, { recursive: true, force: true });
        }

        return {
            success: false,
            replacedCount: 0,
            failedFiles: [],
            reason: `Staging failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Rollback files from backup directory
 */
function rollbackFiles(backupDir: string, targetDir: string): void {
    try {
        const backupFiles = fs.readdirSync(backupDir);

        for (const file of backupFiles) {
            const backupFile = path.join(backupDir, file);
            const targetFile = path.join(targetDir, file);

            try {
                fs.copyFileSync(backupFile, targetFile);
            } catch (error) {
                console.error(`Failed to rollback file ${file}:`, error);
            }
        }

        // Clean up backup directory
        fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
        console.error('Failed to complete rollback:', error);
    }
}

/**
 * Clean up old backup directories (keep only recent ones)
 */
export function cleanupOldBackups(targetDir: string, maxAge: number = 24 * 60 * 60 * 1000): void {
    try {
        const files = fs.readdirSync(targetDir);
        const now = Date.now();

        for (const file of files) {
            if (file.startsWith('.backup-')) {
                const backupPath = path.join(targetDir, file);
                const stat = fs.statSync(backupPath);
                const age = now - stat.mtimeMs;

                if (age > maxAge) {
                    fs.rmSync(backupPath, { recursive: true, force: true });
                    console.log(`Cleaned up old backup: ${file}`);
                }
            }
        }
    } catch (error) {
        console.warn('Failed to cleanup old backups:', error);
    }
}
