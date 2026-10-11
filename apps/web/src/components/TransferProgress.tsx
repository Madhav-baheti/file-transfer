import React from 'react';
import type { TransferProgress as TransferProgressData } from '../lib/transfer';
import styles from './TransferProgress.module.css';

interface TransferProgressProps {
  filename: string;
  totalBytes: number;
  direction: 'sender' | 'receiver';
  progress: TransferProgressData | null;
  status: 'transferring' | 'completed' | 'failed' | 'cancelled';
  error?: string | null;
  onCancel?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export const TransferProgress: React.FC<TransferProgressProps> = ({
  filename,
  totalBytes,
  direction,
  progress,
  status,
  error,
  onCancel,
}) => {
  const percentage = progress?.percentage || 0;
  const transferred = progress?.transferredBytes || 0;
  const speed = progress?.speedBytesPerSec
    ? `${formatBytes(progress.speedBytesPerSec)}/s`
    : 'Starting...';
  const eta = progress?.etaSeconds !== undefined ? `ETA: ${progress.etaSeconds}s` : '';

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.fileName}>
          {direction === 'sender' ? 'Sending: ' : 'Receiving: '}
          {filename}
        </span>
        <span className={styles.percentage}>
          {status === 'completed'
            ? '100%'
            : status === 'failed' || status === 'cancelled'
            ? 'Stopped'
            : `${percentage}%`}
        </span>
      </div>

      <div className={styles.track} role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={styles.fill}
          style={{
            width:
              status === 'completed'
                ? '100%'
                : `${percentage}%`,
          }}
        />
      </div>

      {status === 'transferring' && (
        <>
          <div className={styles.statsRow}>
            <span>
              {formatBytes(transferred)} / {formatBytes(totalBytes)}
            </span>
            <span>{speed}</span>
            <span>{eta}</span>
          </div>

          {onCancel && (
            <button
              type="button"
              className={styles.cancelButton}
              onClick={onCancel}
            >
              Cancel Transfer
            </button>
          )}
        </>
      )}

      {status === 'completed' && (
        <div className={styles.statusIndicator}>
          <span className={styles.checkIcon} aria-hidden="true">✓</span>
          <span>Transfer completed and verified with SHA-256</span>
        </div>
      )}

      {status === 'failed' && (
        <div className={styles.statusIndicator}>
          <span className={styles.errorIcon} aria-hidden="true">✕</span>
          <span>{error || 'Transfer failed'}</span>
        </div>
      )}

      {status === 'cancelled' && (
        <div className={styles.statusIndicator}>
          <span>Transfer cancelled</span>
        </div>
      )}
    </div>
  );
};
