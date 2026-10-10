import { PROTOCOL_VERSION } from '@quickdrop/protocol';
import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>QuickDrop</h1>
        <p className={styles.subtitle}>
          Transfer files securely. No sign-up. No cloud. Just a code.
        </p>
      </header>

      <main className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.icon}>📤</span>
          <h2>Send</h2>
          <p>Share a file or text securely</p>
          <button className={styles.primaryButton}>Get Started</button>
        </div>
        <div className={styles.card}>
          <span className={styles.icon}>📥</span>
          <h2>Receive</h2>
          <p>Enter a code to receive files</p>
          <button className={styles.secondaryButton}>Enter Code</button>
        </div>
      </main>

      <section className={styles.steps}>
        <div className={styles.step}>
          <span className={styles.stepNumber}>1</span>
          <span>Create</span>
        </div>
        <span className={styles.stepArrow}>→</span>
        <div className={styles.step}>
          <span className={styles.stepNumber}>2</span>
          <span>Share Code</span>
        </div>
        <span className={styles.stepArrow}>→</span>
        <div className={styles.step}>
          <span className={styles.stepNumber}>3</span>
          <span>Transfer</span>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>🔒 End-to-end encrypted</span>
        <span>⚡ Peer-to-peer</span>
        <span>🚫 No storage</span>
      </footer>

      <p className={styles.version}>Protocol v{PROTOCOL_VERSION}</p>
    </div>
  );
}
