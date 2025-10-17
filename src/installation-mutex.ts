/**
 * Simple mutex to ensure only one installation happens at a time
 * This prevents race conditions when multiple installation requests happen concurrently
 */
class InstallationMutex {
    private isLocked: boolean = false;
    private queue: Array<() => void> = [];

    /**
     * Acquire the lock (wait if already locked)
     */
    async acquire(): Promise<void> {
        if (!this.isLocked) {
            this.isLocked = true;
            return Promise.resolve();
        }

        // Wait for lock to be released
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    /**
     * Release the lock (and notify next in queue)
     */
    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                next();
            }
        } else {
            this.isLocked = false;
        }
    }

    /**
     * Execute a function with the lock
     */
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    /**
     * Check if currently locked
     */
    isInstalling(): boolean {
        return this.isLocked;
    }
}

// Singleton instance
export const installationMutex = new InstallationMutex();
