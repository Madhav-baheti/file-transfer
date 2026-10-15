import React, { useState } from 'react';
import type { ChatMessage } from '../lib/session';
import type { TransferState } from '../lib/transferState';
import { BlobDownloadLink } from '../components/BlobDownloadLink';
import { DropZone } from '../components/DropZone';
import { IncomingOffer } from '../components/IncomingOffer';
import { TransferProgress } from '../components/TransferProgress';
import { VerificationPanel } from '../components/VerificationPanel';
import styles from './Screens.module.css';

interface ConnectedScreenProps {
  role: 'initiator' | 'responder' | null;
  verification: {
    sas: string;
    required: boolean;
    confirmed: boolean;
  };
  onConfirmVerification: () => void;
  onRejectVerification: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onDisconnect: () => void;
  sendError?: string | null;

  // File Transfer props
  transferState: TransferState;
  onSelectFile: (file: File) => void;
  onAcceptTransfer: () => void;
  onDeclineTransfer: () => void;
  onCancelTransfer: () => void;
  onResetTransfer: () => void;
}

export const ConnectedScreen: React.FC<ConnectedScreenProps> = ({
  role,
  verification,
  onConfirmVerification,
  onRejectVerification,
  messages,
  onSendMessage,
  onDisconnect,
  sendError,
  transferState,
  onSelectFile,
  onAcceptTransfer,
  onDeclineTransfer,
  onCancelTransfer,
  onResetTransfer,
}) => {
  const [inputText, setInputText] = useState('');

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verification.confirmed) return;
    const trimmed = inputText.trim();
    if (trimmed) {
      onSendMessage(trimmed);
      setInputText('');
    }
  };

  return (
    <div className={styles.connectedCard}>
      <div className={styles.topBar}>
        <div className={styles.connectedBadge}>
          <div className={styles.onlineDot} />
          <span>Connected ({role === 'initiator' ? 'Host' : 'Peer'})</span>
        </div>
        <button className={styles.disconnectButton} onClick={onDisconnect} type="button">
          Disconnect
        </button>
      </div>

      {verification.required && !verification.confirmed && (
        <VerificationPanel
          sas={verification.sas}
          onConfirm={onConfirmVerification}
          onReject={onRejectVerification}
        />
      )}
      {verification.confirmed && (
        <span className={styles.connectedBadge}>
          {verification.required ? `Verified · ${verification.sas}` : 'Verified by QR code'}
        </span>
      )}

      {/* ─── File Transfer Section (Components using tokens.css) ────────── */}
      <div className={styles.transferBox}>
        {transferState.status === 'idle' && (
          <>
            <DropZone onFileSelected={onSelectFile} disabled={!verification.confirmed} />
            {!verification.confirmed && (
              <p className={styles.subtle}>Verify the connection first</p>
            )}
          </>
        )}

        {/* Incoming offer prompt for receiver */}
        {transferState.status === 'offered' && transferState.direction === 'receiver' && transferState.offer && (
          <IncomingOffer
            offer={transferState.offer}
            onAccept={onAcceptTransfer}
            onDecline={onDeclineTransfer}
          />
        )}

        {/* Active Transfer Progress */}
        {transferState.status === 'transferring' && transferState.offer && (
          <TransferProgress
            filename={transferState.offer.name}
            totalBytes={transferState.offer.size}
            direction={transferState.direction || 'sender'}
            progress={transferState.progress}
            status="transferring"
            onCancel={onCancelTransfer}
          />
        )}

        {transferState.status === 'verifying' && transferState.offer && (
          <TransferProgress
            filename={transferState.offer.name}
            totalBytes={transferState.offer.size}
            direction="receiver"
            progress={transferState.progress}
            status="verifying"
            onCancel={onCancelTransfer}
          />
        )}

        {transferState.status === 'awaiting_confirmation' && transferState.offer && (
          <TransferProgress
            filename={transferState.offer.name}
            totalBytes={transferState.offer.size}
            direction={transferState.direction || 'sender'}
            progress={transferState.progress}
            status="awaiting_confirmation"
            onCancel={onCancelTransfer}
          />
        )}

        {/* Transfer Completed */}
        {transferState.status === 'completed' && transferState.offer && (
          <div className={styles.noticeBox}>
            <TransferProgress
              filename={transferState.offer.name}
              totalBytes={transferState.offer.size}
              direction={transferState.direction || 'sender'}
              progress={transferState.progress}
              status="completed"
            />
            {transferState.completedBlob && (
              <BlobDownloadLink
                blob={transferState.completedBlob}
                filename={transferState.offer.name || 'download'}
                className={styles.downloadLink}
              >
                Save {transferState.offer.name}
              </BlobDownloadLink>
            )}
            <button className={styles.copyButton} onClick={onResetTransfer} type="button">
              Transfer Another File
            </button>
          </div>
        )}

        {/* Transfer Failed or Cancelled */}
        {(transferState.status === 'failed' || transferState.status === 'cancelled') && transferState.offer && (
          <div className={styles.noticeBox}>
            <TransferProgress
              filename={transferState.offer.name}
              totalBytes={transferState.offer.size}
              direction={transferState.direction || 'sender'}
              progress={transferState.progress}
              status={transferState.status}
              error={transferState.error}
            />
            <button className={styles.copyButton} onClick={onResetTransfer} type="button">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ─── Text Chat Section ─────────────────────────────────────────── */}
      <div className={styles.chatArea}>
        {messages.length === 0 ? (
          <div className={styles.emptyNotice}>
            <p>Peer-to-peer data channel is connected!</p>
            <p className={styles.subtle}>Connected. Send files above or messages below.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={m.sender === 'self' ? styles.selfMessage : styles.peerMessage}
            >
              <div className={styles.messageBubble}>
                <p>{m.text}</p>
                <span className={styles.timeLabel}>{m.timestamp}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {sendError && <p className={styles.errorMessage}>{sendError}</p>}

      <form onSubmit={handleSend} className={styles.chatInputRow}>
        <input
          type="text"
          className={styles.textInput}
          placeholder="Type a message (max 4000 chars)..."
          maxLength={4000}
          value={inputText}
          disabled={!verification.confirmed}
          aria-describedby={!verification.confirmed ? 'verification-chat-hint' : undefined}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button
          type="submit"
          className={styles.sendButton}
          disabled={!verification.confirmed || !inputText.trim()}
        >
          Send
        </button>
      </form>
      {!verification.confirmed && (
        <p id="verification-chat-hint" className={styles.subtle}>
          Verify the connection first
        </p>
      )}
    </div>
  );
};
