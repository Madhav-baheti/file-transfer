import React, { useEffect, useId, useRef } from 'react';
import type { FileOfferMsg } from '../lib/protocol';
import styles from './IncomingOffer.module.css';

interface IncomingOfferProps {
  offer: FileOfferMsg;
  onAccept: () => void;
  onDecline: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export const IncomingOffer: React.FC<IncomingOfferProps> = ({
  offer,
  onAccept,
  onDecline,
}) => {
  const isOneGigabyteOrMore = offer.size >= 1024 * 1024 * 1024;
  const supportsFileSystemAccess =
    typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  const titleId = useId();
  const detailsId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const firstButton = dialog?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    firstButton?.focus();

    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDecline();
      return;
    }
    if (event.key !== 'Tab') return;

    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    );
    if (!buttons?.length) return;

    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailsId}
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          Incoming file
        </h2>
        <div className={styles.fileMeta} id={detailsId}>
          <span className={styles.fileName}>{offer.name}</span>
          <span className={styles.fileDetails}>
            {formatBytes(offer.size)} · {offer.mime || 'application/octet-stream'}
          </span>
        </div>

        {!supportsFileSystemAccess && isOneGigabyteOrMore && (
          <div className={styles.warningBox} role="status">
            File is over 1 GB. Your browser will keep the transfer in memory while it is received.
          </div>
        )}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.acceptButton}
            onClick={onAccept}
          >
            Accept
          </button>
          <button
            type="button"
            className={styles.declineButton}
            onClick={onDecline}
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
};
