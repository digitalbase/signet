import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../../lib/clipboard.js';
import styles from './QRModal.module.css';

interface QRModalProps {
  open: boolean;
  onClose: () => void;
  value: string;
  title?: string;
}

export function QRModal({ open, onClose, value, title = 'Scan QR Code' }: QRModalProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(value);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.qrContainer}>
          <QRCodeSVG
            value={value}
            size={240}
            level="M"
            bgColor="transparent"
            fgColor="currentColor"
          />
        </div>

        <div className={styles.valueContainer}>
          <code className={styles.value}>
            {value.length > 50 ? `${value.slice(0, 25)}...${value.slice(-20)}` : value}
          </code>
          <button className={styles.copyButton} onClick={handleCopy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
