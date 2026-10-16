import React, { useState } from 'react';
import { ShortCodeRegex } from '@quickdrop/protocol';
import styles from './Screens.module.css';

interface JoinScreenProps {
  onJoin: (code: string) => void;
  onCancel: () => void;
  error?: string | null;
  isConnecting?: boolean;
  isWaking?: boolean;
}

export const JoinScreen: React.FC<JoinScreenProps> = ({
  onJoin,
  onCancel,
  error,
  isConnecting = false,
  isWaking = false,
}) => {
  const [inputCode, setInputCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ShortCodeRegex.test(inputCode) && !isConnecting) {
      onJoin(inputCode.trim());
    }
  };

  return (
    <div className={styles.screenCard}>
      <div className={styles.innerCard}>
        <button className={styles.backButton} onClick={onCancel} type="button">
          ← Back
        </button>

        <div className={styles.header}>
          <h2>Join Session</h2>
          <p className={styles.description}>
            Enter the short code shown on the creating device.
          </p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[1-9][0-9]{5}"
            maxLength={6}
            className={styles.codeInput}
            placeholder="e.g. 482193"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={isConnecting}
            autoFocus
          />

          {error && <p className={styles.errorMessage}>{error}</p>}

          {isConnecting && (
            <div className={styles.statusBox} role="status" aria-live="polite">
              <div className={styles.pulseDot} />
              <span>
                {isWaking
                  ? 'Waking up the pairing service. On the free plan this can take up to a minute.'
                  : 'Connecting to the pairing service...'}
              </span>
            </div>
          )}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={!ShortCodeRegex.test(inputCode) || isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
};
