import type { ChatRepository } from '../modules/chat/repository.js';

export interface CleanupScheduler {
  /** Runs one pass now. Exposed so startup and tests do not have to wait for the interval. */
  runOnce(): Promise<void>;
  stop(): void;
}

/**
 * Runs the retention sweep on an interval inside the API process.
 *
 * A pass never overlaps itself and never throws: a failed sweep is logged and the next
 * tick tries again, because losing the scheduler would silently stop all deletion.
 */
export function startCleanupScheduler(repository: ChatRepository, intervalMs: number): CleanupScheduler {
  let running = false;

  const runOnce = async (): Promise<void> => {
    if (running) {
      console.warn(JSON.stringify({ event: 'chat_cleanup_skipped', reason: 'previous_run_in_progress' }));
      return;
    }
    running = true;
    const startedAt = Date.now();
    try {
      const deleted = await repository.cleanupExpired();
      console.info(JSON.stringify({ event: 'chat_cleanup_completed', duration_ms: Date.now() - startedAt, ...deleted }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'chat_cleanup_failed',
        duration_ms: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      running = false;
    }
  };

  // unref 로 두어 정리 작업이 프로세스 종료를 붙잡지 않게 한다.
  const timer = setInterval(() => void runOnce(), intervalMs);
  timer.unref();

  return { runOnce, stop: () => clearInterval(timer) };
}
