    {state.status === 'connecting' && state.role === 'initiator' && (
              <div className={styles.statusCardOuter}>
                <div className={styles.statusCardInner}>
                  <div className={styles.statusIcon} aria-hidden="true">
                    ⚡
                  </div>
                  <h2 className={styles.statusTitle}>Connecting...</h2>
                  <p className={styles.statusText}>
                    {signalingPending
                      ? 'Waking up the pairing service. On the free Render plan this can take up to a minute.'
                      : 'Peer joined. Establishing direct WebRTC connection...'}
                  </p>
                  <button
                    className={styles.outlinedActionButton}
                    onClick={handleReset}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
