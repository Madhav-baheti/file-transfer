import React from 'react';
import styles from './DecorativeTiles.module.css';

export const DecorativeTiles: React.FC = () => {
  return (
    <div className={styles.tilesContainer} aria-hidden="true">
      {/* Tile 1: Diagonal split Mint + Ink */}
      <div className={`${styles.tile} ${styles.tileOne}`}>
        <svg className={styles.tileSvg} viewBox="0 0 100 100">
          <polygon points="0,0 100,0 0,100" fill="var(--color-accent-mint)" />
          <polygon points="100,0 100,100 0,100" fill="var(--color-accent-ink)" />
        </svg>
      </div>

      {/* Tile 2: Geometric stripes Orange + Cream */}
      <div className={`${styles.tile} ${styles.tileTwo}`}>
        <svg className={styles.tileSvg} viewBox="0 0 100 100">
          <rect width="100" height="100" fill="var(--color-accent-cream)" />
          <rect y="0" width="100" height="25" fill="var(--color-accent-orange)" />
          <rect y="50" width="100" height="25" fill="var(--color-accent-orange)" />
        </svg>
      </div>

      {/* Tile 3: Quarter circle Red + Tan */}
      <div className={`${styles.tile} ${styles.tileThree}`}>
        <svg className={styles.tileSvg} viewBox="0 0 100 100">
          <rect width="100" height="100" fill="var(--color-accent-tan)" />
          <path d="M0,0 L100,0 A100,100 0 0,1 0,100 Z" fill="var(--color-accent-red)" />
        </svg>
      </div>

      {/* Tile 4: Half-arch / circles Indigo + Mint */}
      <div className={`${styles.tile} ${styles.tileFour}`}>
        <svg className={styles.tileSvg} viewBox="0 0 100 100">
          <rect width="100" height="100" fill="var(--color-accent-indigo)" />
          <circle cx="50" cy="50" r="35" fill="var(--color-accent-mint)" />
        </svg>
      </div>
    </div>
  );
};
