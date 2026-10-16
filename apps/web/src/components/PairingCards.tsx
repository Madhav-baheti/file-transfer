import React, { useState } from 'react';
import { ShortCodeRegex } from '@quickdrop/protocol';
import styles from './PairingCards.module.css';

interface PairingCardsProps {
  onCreateSession: () => void;
  onJoinSession: (code: string) => void;
}

export const PairingCards: React.FC<PairingCardsProps> = ({
  onCreateSession,
  onJoinSession,
}) => {
  const [joinCode, setJoinCode] = useState('');

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = joinCode.trim();
    if (ShortCodeRegex.test(trimmed)) {
      onJoinSession(trimmed);
    }
  };

  const handleCodeChange = (value: string) => {
    setJoinCode(value.replace(/\D/g, '').slice(0, 6));
  };

  return (
    <div className={styles.pairingGrid}>
      {/* 1. Create Session Card */}
      <div className={styles.outerContainer}>
        <div className={styles.innerCard}>
          <div className={styles.iconCircle} aria-hidden="true">
            <svg className={styles.iconSvg} viewBox="0 0 24 24" fill="none">
              <path d="M12 4v12M5 11l7-7 7 7" />
              <path d="M4 20h16" />
            </svg>
          </div>

          <h2 className={styles.cardTitle}>Create session</h2>
          <p className={styles.cardDesc}>
            Generate a code for another device to pair and exchange files directly.
          </p>

          <button
            type="button"
            className={styles.createButton}
            onClick={onCreateSession}
          >
            Create session
          </button>
        </div>
      </div>

      {/* 2. Join with Code Card */}
      <div className={styles.outerContainer}>
        <div className={styles.innerCard}>
          <div className={styles.iconCircle} aria-hidden="true">
            <svg className={styles.iconSvg} viewBox="0 0 24 24" fill="none">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>

          <h2 className={styles.cardTitle}>Join with code</h2>
          <p className={styles.cardDesc}>
            Enter the 6-digit code shown on the other device.
          </p>

          <form onSubmit={handleJoinSubmit} className={styles.joinForm}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[1-9][0-9]{5}"
              maxLength={6}
              className={styles.codeInput}
              placeholder="e.g. 482193"
              value={joinCode}
              onChange={(e) => handleCodeChange(e.target.value)}
              aria-label="Session pairing code"
            />
            <button
              type="submit"
              className={styles.joinButton}
              disabled={!ShortCodeRegex.test(joinCode)}
            >
              Connect
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
