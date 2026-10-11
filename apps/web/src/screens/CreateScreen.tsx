import React, { useState } from 'react';
import styles from './Screens.module.css';

interface CreateScreenProps {
  code: string | null;
  onCancel: () => void;
}

export const CreateScreen: React.FC<CreateScreenProps> = ({ code, onCancel }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={styles.screenCard}>
      <div className={styles.innerCard}>
        <button className={styles.backButton} onClick={onCancel} type="button">
          ← Back
        </button>

        <div className={styles.header}>
          <h2>Session Created</h2>
          <p className={styles.description}>
            Share this short code with the other device to connect.
          </p>
        </div>

        <div className={styles.codeContainer}>
          <span className={styles.codeBadge}>{code || 'Generating...'}</span>
          <button
            className={styles.copyButton}
            onClick={handleCopy}
            disabled={!code}
            type="button"
          >
            {copied ? '✓ Copied' : 'Copy Code'}
          </button>
        </div>

        <div className={styles.statusBox}>
          <div className={styles.pulseDot} />
          <span>Waiting for peer to join... (Expires in 5 min)</span>
        </div>

        <button className={styles.cancelButton} onClick={onCancel} type="button">
          Cancel Session
        </button>
      </div>
    </div>
  );
};
