import React from 'react';
import styles from './VerificationPanel.module.css';

interface VerificationPanelProps {
  sas: string;
  onConfirm: () => void;
  onReject: () => void;
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  sas,
  onConfirm,
  onReject,
}) => (
  <section className={styles.panel} aria-labelledby="verification-heading">
    <h2 id="verification-heading" className={styles.heading}>
      Verify this connection
    </h2>
    <p className={styles.digits} aria-label={`Verification digits ${sas}`}>
      {sas}
    </p>
    <p className={styles.instructions}>
      Compare these digits with the other device. They must be identical. If they differ,
      someone may be intercepting the connection.
    </p>
    <div className={styles.actions}>
      <button className={styles.primaryButton} onClick={onConfirm} type="button">
        They match
      </button>
      <button className={styles.outlineButton} onClick={onReject} type="button">
        They don't match
      </button>
    </div>
  </section>
);
