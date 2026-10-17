import React, { useState } from 'react';
import { QRDisplay } from '../components/QRDisplay';
import styles from './Screens.module.css';

interface CreateScreenProps {
  code: string | null;
  pairingUrl: string | null;
  isWaking?: boolean;
  onCancel: () => void;
}

export const CreateScreen: React.FC<CreateScreenProps> = ({
  code,
  pairingUrl,
  isWaking = false,
  onCancel,
}) => {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const handleCopy = async (value: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className={styles.screenCard}>
      <div className={`${styles.innerCard} ${styles.createInnerCard}`}>
        <button className={styles.backButton} onClick={onCancel} type="button">
          ← Back
        </button>

        <div className={styles.header}>
          <h2>Session Created</h2>
          <p className={styles.description}>
            Join using the QR code or enter the six-digit code on the other device.
          </p>
        </div>

        {pairingUrl && (
          <div className={styles.qrContainer}>
            <QRDisplay value={pairingUrl} label="QR code to join this session" />
            <button
              className={styles.copyButton}
              onClick={() => void handleCopy(pairingUrl, 'link')}
              disabled={!code}
              type="button"
            >
              {copied === 'link' ? '✓ Copied' : 'Copy link'}
            </button>
            <p className={styles.shareWarning}>
              Anyone with this link can join. Share it only with the device you want to connect
            </p>
          </div>
        )}

        <div className={styles.codeContainer}>
          <span className={styles.codeBadge}>{code || 'Generating...'}</span>
          {!pairingUrl && (
            <button
              className={styles.copyButton}
              onClick={() => code && void handleCopy(code, 'code')}
              disabled={!code}
              type="button"
            >
              {copied === 'code' ? '✓ Copied' : 'Copy Code'}
            </button>
          )}
        </div>

        {pairingUrl && code && (
          <button className={styles.copyCodeButton} onClick={() => void handleCopy(code, 'code')} type="button">
            {copied === 'code' ? '✓ Code copied' : 'Copy code'}
          </button>
        )}

        <div className={styles.statusBox}>
          <div className={styles.pulseDot} />
          <span>
            {isWaking
              ? 'Waking up the pairing service. On the free plan this can take up to a minute.'
              : 'Waiting for peer to join... (Expires in 5 min)'}
          </span>
        </div>

        <button className={styles.cancelButton} onClick={onCancel} type="button">
          Cancel Session
        </button>
      </div>
    </div>
  );
};
