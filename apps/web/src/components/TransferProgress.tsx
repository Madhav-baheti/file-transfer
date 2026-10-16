import React from 'react';
import type { TransferProgress as TransferProgressData } from '../lib/transfer';
import styles from './TransferProgress.module.css';

interface TransferProgressProps {
  filename: string;
  totalBytes: number;
  direction: 'sender' | 'receiver';
  progress: TransferProgressData | null;
  status:
    | 'transferring'
    | 'verifying'
    | 'awaiting_confirmation'
    | 'completed'
    | 'failed'
    | 'cancelled';
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
  const percentage =
    status === 'awaiting_confirmation' || status === 'verifying'
      ? 100
      : progress?.percentage || 0;
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
          {status === 'completed' || status === 'awaiting_confirmation' || status === 'verifying'
            ? '100%'
            : status === 'failed' || status === 'cancelled'
            ? 'Stopped'
            : `${percentage}%`}
        </span>
      </div>

      <div
        className={styles.track}
        role="progressbar"
        aria-label={`${direction === 'sender' ? 'Sending' : 'Receiving'} ${filename}`}
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${percentage}% complete`}
        aria-live="off"
      >
        <div
          className={styles.fill}
          style={{
            width:
              status === 'completed' || status === 'awaiting_confirmation' || status === 'verifying'
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

      {status === 'awaiting_confirmation' && (
        <div className={styles.statusIndicator} role="status" aria-live="polite">
          <span aria-hidden="true">⏳</span>
          <span>Sent, waiting for the other device to verify</span>
        </div>
      )}

      {status === 'verifying' && (
        <div className={styles.statusIndicator} role="status" aria-live="polite">
          <span className={styles.verifyingIndicator} aria-hidden="true" />
          <span>Verifying and saving...</span>
        </div>
      )}

      {status === 'completed' && (
        <div className={styles.statusIndicator} role="status" aria-live="polite">
          <span className={styles.checkIcon} aria-hidden="true">✓</span>
          <span>{direction === 'sender' ? 'Delivered and verified' : 'Received and verified'}</span>
        </div>
      )}

      {status === 'failed' && (
        <div className={styles.statusIndicator} role="status" aria-live="polite">
          <span className={styles.errorIcon} aria-hidden="true">✕</span>
          <span>{error || 'Transfer failed'}</span>
        </div>
      )}

      {status === 'cancelled' && (
        <div className={styles.statusIndicator} role="status" aria-live="polite">
          <span>Transfer cancelled</span>
        </div>
      )}
    </div>
  );
};
