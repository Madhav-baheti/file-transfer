import React from 'react';
import styles from './NavBar.module.css';

interface NavBarProps {
  onStartSession?: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

export const NavBar: React.FC<NavBarProps> = ({
  onStartSession,
  isDark,
  onToggleTheme,
}) => {
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
          <a href="#about-transfers" className={styles.navLink}>
            About transfers
          </a>
          <a href="#features" className={styles.navLink}>
            Features
          </a>
        </div>
      </div>

      <div className={styles.rightGroup}>
        <button
          type="button"
          className={styles.themeButton}
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          onClick={onToggleTheme}
        >
          <svg className={styles.themeIcon} viewBox="0 0 24 24" aria-hidden="true">
            {isDark ? (
              <path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5a8.5 8.5 0 1 0 12 12Z" />
            ) : (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
              </>
            )}
          </svg>
        </button>
        <button
          type="button"
          className={styles.mintIconButton}
          aria-label="Create a session"
          onClick={onStartSession}
        >
          <svg className={styles.iconSvg} viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12l7-7 7 7" />
          </svg>
        </button>

      </div>
    </nav>
  );
};
