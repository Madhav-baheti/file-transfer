import React, { useState } from 'react';
import styles from './Screens.module.css';

interface JoinScreenProps {
  onJoin: (code: string) => void;
  onCancel: () => void;
  error?: string | null;
  isConnecting?: boolean;
}

export const JoinScreen: React.FC<JoinScreenProps> = ({
  onJoin,
  onCancel,
  error,
  isConnecting = false,
}) => {
  const [inputCode, setInputCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCode.trim() && !isConnecting) {
      onJoin(inputCode.trim());
    }
  };

  return (
    <div className={styles.screenCard}>
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
          className={styles.codeInput}
          placeholder="e.g. 7-kiwi-lamp"
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
          disabled={isConnecting}
          autoFocus
        />

        {error && <p className={styles.errorMessage}>{error}</p>}

        <button
          type="submit"
          className={styles.submitButton}
          disabled={!inputCode.trim() || isConnecting}
        >
          {isConnecting ? 'Connecting...' : 'Connect'}
        </button>
      </form>
    </div>
  );
};
