import React from 'react';
import styles from './NavBar.module.css';

interface NavBarProps {
  onStartSession?: () => void;
}

export const NavBar: React.FC<NavBarProps> = ({ onStartSession }) => {
  return (
    <nav className={styles.nav} aria-label="Main Navigation">
      <div className={styles.leftGroup}>
        <a href="#hero" className={styles.logo}>
          <div className={styles.logoMark} aria-hidden="true">
            <span className={styles.logoCircleOne} />
            <span className={styles.logoCircleTwo} />
          </div>
          <span>quickdrop</span>
        </a>

        <div className={styles.links}>
          <a href="#how-it-works" className={styles.navLink}>
            How it works
          </a>
          <a href="#why-private" className={styles.navLink}>
            Why it&apos;s private
          </a>
          <a href="#features" className={styles.navLink}>
            Features
          </a>
        </div>
      </div>

      <div className={styles.rightGroup}>
        <button
          type="button"
          className={styles.mintIconButton}
          aria-label="Direct Transfer Action"
          onClick={onStartSession}
        >
          <svg className={styles.iconSvg} viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12l7-7 7 7" />
          </svg>
        </button>

        <button
          type="button"
          className={styles.outlinedButton}
          onClick={onStartSession}
        >
          Share Direct
        </button>
      </div>
    </nav>
  );
};
