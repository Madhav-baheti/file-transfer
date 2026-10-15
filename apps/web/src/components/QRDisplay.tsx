import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import styles from './QRDisplay.module.css';

interface QRDisplayProps {
  value: string;
  size?: number;
  label: string;
}

export function QRDisplay({ value, size = 240, label }: QRDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    let active = true;
    setGenerated(false);
    if (!canvas) return;

    const computed = getComputedStyle(document.documentElement);
    const dark = computed.getPropertyValue('--color-accent-ink').trim();
    const light = computed.getPropertyValue('--color-frame').trim();

    QRCode.toCanvas(canvas, value, {
      errorCorrectionLevel: 'M',
      width: size,
      color: { dark, light },
    }).then(
      () => {
        if (active) setGenerated(true);
      },
      () => {
        if (active) setGenerated(false);
      },
    );

    return () => {
      active = false;
    };
  }, [size, value]);

  return (
    <div className={styles.quietZone} role="img" aria-label={label} hidden={!generated}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
