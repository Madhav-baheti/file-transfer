import React from 'react';
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

  return (
    <div className={styles.card}>
      <span className={styles.title}>Incoming File</span>
      <div className={styles.fileMeta}>
        <span className={styles.fileName}>{offer.name}</span>
        <span className={styles.fileDetails}>
          {formatBytes(offer.size)} · {offer.mime || 'application/octet-stream'}
        </span>
      </div>

      {!supportsFileSystemAccess && isOneGigabyteOrMore && (
        <div className={styles.warningBox}>
          ⚠️ File is over 1 GB. Because your browser does not support the File System Access API, this transfer will use RAM.
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
  );
};
