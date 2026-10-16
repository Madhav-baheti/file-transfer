import type { FileQueueEntry } from '../lib/fileQueue';
import styles from './FileQueue.module.css';

interface FileQueueProps {
  entries: FileQueueEntry[];
  onCancel: (entry: FileQueueEntry) => void;
}

const labels: Record<FileQueueEntry['status'], string> = {
  queued: 'Queued',
  'awaiting-acceptance': 'Awaiting acceptance',
  transferring: 'Transferring',
  'awaiting-confirmation': 'Verifying delivery',
  complete: 'Complete',
  declined: 'Declined',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, unit)).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function FileQueue({ entries, onCancel }: FileQueueProps) {
  if (entries.length === 0) return null;

  return (
    <section className={styles.queue} aria-labelledby="file-queue-heading">
      <h2 id="file-queue-heading" className={styles.heading}>
        Files to send
      </h2>
      <ol className={styles.list}>
        {entries.map((entry) => {
          const canCancel = ['queued', 'awaiting-acceptance', 'transferring', 'awaiting-confirmation']
            .includes(entry.status);
          const percentage = entry.progress?.percentage ?? 0;
          return (
            <li key={entry.id} className={styles.item}>
              <div className={styles.details}>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.meta}>
                  {formatBytes(entry.size)} · {labels[entry.status]}
                </span>
                {entry.status === 'transferring' && (
                  <div
                    className={styles.track}
                    role="progressbar"
                    aria-label={`Sending ${entry.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percentage}
                    aria-valuetext={`${percentage}% complete`}
                    aria-live="off"
                  >
                    <span className={styles.fill} style={{ width: `${percentage}%` }} />
                  </div>
                )}
                {entry.error && <span className={styles.error}>{entry.error}</span>}
              </div>
              {canCancel && (
                <button
                  className={styles.cancelButton}
                  type="button"
                  onClick={() => onCancel(entry)}
                  aria-label={`Cancel ${entry.name}`}
                >
                  Cancel
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
