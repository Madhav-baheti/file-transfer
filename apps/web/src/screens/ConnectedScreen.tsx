import React, { useState } from 'react';
import type { ChatMessage } from '../lib/session';
import styles from './Screens.module.css';

interface ConnectedScreenProps {
  role: 'initiator' | 'responder' | null;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onDisconnect: () => void;
}

export const ConnectedScreen: React.FC<ConnectedScreenProps> = ({
  role,
  messages,
  onSendMessage,
  onDisconnect,
}) => {
  const [inputText, setInputText] = useState('');

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  return (
    <div className={styles.screenCard}>
      <div className={styles.topBar}>
        <div className={styles.connectedBadge}>
          <div className={styles.onlineDot} />
          <span>Connected ({role === 'initiator' ? 'Sender / Host' : 'Receiver / Peer'})</span>
        </div>
        <button className={styles.disconnectButton} onClick={onDisconnect} type="button">
          Disconnect
        </button>
      </div>

      <div className={styles.chatArea}>
        {messages.length === 0 ? (
          <div className={styles.emptyNotice}>
            <p>Peer-to-peer data channel is connected!</p>
            <p className={styles.subtle}>Send a plaintext test message below.</p>
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

      <form onSubmit={handleSend} className={styles.chatInputRow}>
        <input
          type="text"
          className={styles.textInput}
          placeholder="Type a plaintext message..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button
          type="submit"
          className={styles.sendButton}
          disabled={!inputText.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
};
