import React, { useRef, useState } from 'react';
import styles from './DropZone.module.css';

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({
  onFileSelected,
  disabled = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!disabled && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      onFileSelected(file);
    }
  };

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      onFileSelected(file);
      e.target.value = '';
    }
  };

  return (
    <div
      className={`${styles.outerContainer} ${
        isDragOver ? styles.outerContainerHover : ''
      } ${disabled ? styles.outerContainerDisabled : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        className={styles.fileInputHidden}
        onChange={handleFileChange}
        disabled={disabled}
      />
      <button
        type="button"
        className={styles.innerCard}
        onClick={handleClick}
        disabled={disabled}
        aria-label="Add your files"
      >
        <div className={styles.plusCircle} aria-hidden="true">
          <svg className={styles.plusIcon} viewBox="0 0 24 24" fill="none">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <span className={styles.label}>
          {disabled ? 'Verify the connection first' : 'Add your files'}
        </span>
        <span className={styles.hint}>
          {disabled ? 'Confirm the digits above before sending a file' : 'Drop a file or browse (Up to 20 GB)'}
        </span>
      </button>
    </div>
  );
};
