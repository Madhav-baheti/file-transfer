import React from 'react';
import { PROTOCOL_VERSION } from '@quickdrop/protocol';
import styles from './LightSections.module.css';

export const LightSections: React.FC = () => {
  return (
    <div className={styles.wrapper}>
      {/* ─── How It Works ────────────────────────────────────────────── */}
      <section id="how-it-works" className={styles.section} aria-labelledby="how-it-works-heading">
        <h2 id="how-it-works-heading" className={styles.sectionHeading}>
          How it works
        </h2>

        <div className={styles.cardsGrid}>
          <div className={styles.card}>
            <span className={styles.stepNumber}>01</span>
            <h3 className={styles.cardTitle}>Create session</h3>
            <p className={styles.cardText}>
              Click create to instantly reserve a direct pairing channel and obtain a temporary 6-character code.
            </p>
          </div>

          <div className={styles.card}>
            <span className={styles.stepNumber}>02</span>
            <h3 className={styles.cardTitle}>Share the code</h3>
            <p className={styles.cardText}>
              Share the short code with your peer on phone, tablet or desktop. Devices negotiate peer-to-peer WebRTC directly.
            </p>
          </div>

          <div className={styles.card}>
            <span className={styles.stepNumber}>03</span>
            <h3 className={styles.cardTitle}>Send direct</h3>
            <p className={styles.cardText}>
              Drop your files. Chunks stream device-to-device with backpressure handling and incremental SHA-256 verification.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Why It's Private ────────────────────────────────────────── */}
      <section id="why-private" className={styles.section} aria-labelledby="why-private-heading">
        <h2 id="why-private-heading" className={styles.sectionHeading}>
          Why it&apos;s private
        </h2>

        <div className={styles.cardsGrid}>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>End-to-End Direct</h3>
            <p className={styles.cardText}>
              Once signaling exchanges ICE credentials, the connection runs over an encrypted RTCDataChannel directly between devices.
            </p>
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Zero Cloud Storage</h3>
            <p className={styles.cardText}>
              No accounts, no database, no intermediate file hosting. Nothing is ever saved to a server.
            </p>
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Streamed & Verified</h3>
            <p className={styles.cardText}>
              Uses File System streaming to avoid RAM overload, and validates byte totals and SHA-256 checksums on both ends.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <span>quickdrop</span>
          <span>·</span>
          <span>Protocol v{PROTOCOL_VERSION}</span>
        </div>

        <div className={styles.footerLinks}>
          <span>Direct WebRTC</span>
          <span>·</span>
          <span>No Cloud</span>
          <span>·</span>
          <span>Open Source</span>
        </div>
      </footer>
    </div>
  );
};
