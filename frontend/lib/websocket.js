/**
 * Manages the WebSocket connection to the Python backend for a Hifz session.
 * If the connection drops unexpectedly mid-session it auto-reconnects every 3s and
 * resumes from the current word (via getResumeIndex), so the reciter is never stuck.
 */
export function openHifzSession({
  surahNumber,
  startAyah,
  endAyah,
  includeBismillah,
  getResumeIndex,
  onWordResult,
  onSilenceAlert,
  onSessionComplete,
  onError,
  onReady,
  onReconnecting,
}) {
  // The backend serves the socket at /ws and expects a JSON "sessionStart" first
  // (API.md §3). Accept the backend URL with OR without a trailing "/ws" so a value
  // like "ws://host:8000/ws" never becomes a broken "/ws/ws" path that 404s the handshake.
  let backendBase = process.env.NEXT_PUBLIC_PYTHON_BACKEND_WS;
  if (!backendBase) {
    backendBase = `ws://${window.location.hostname}:8000`;
  }
  const normalizedBase = backendBase.replace(/\/+$/, "").replace(/\/ws$/, "");
  const socketUrl = `${normalizedBase}/ws`;

  let activeSocket = null;
  let isClosing = false;
  let reconnectTimer = null;

  // Opens a fresh socket and (re)starts the session from the current word position.
  function connect() {
    console.info("[ws] connecting ->", socketUrl);
    const ws = new WebSocket(socketUrl);
    activeSocket = ws;

    ws.onopen = () => {
      console.info("[ws] open — sending sessionStart");
      const resumeFromWordIndex = getResumeIndex ? getResumeIndex() : 0;
      ws.send(
        JSON.stringify({
          type: "sessionStart",
          surahNumber,
          startAyah,
          endAyah,
          includeBismillah,
          resumeFromWordIndex,
        })
      );
      if (onReady) onReady(ws);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "error") {
          if (onError) onError(data);
        } else if (data.type === "silenceAlert") {
          if (onSilenceAlert) onSilenceAlert(data.silenceDurationSeconds);
        } else if (data.type === "sessionComplete") {
          if (onSessionComplete) onSessionComplete(data.summary);
        } else if (data.status) {
          // A word result (correct / wrong / skipped).
          if (onWordResult) onWordResult(data);
        }
      } catch (parseError) {
        console.error("Failed to parse WebSocket message:", parseError, event.data);
      }
    };

    ws.onerror = () => {
      console.warn("[ws] error event (the browser will fire close next)");
      // Swallow — onclose decides whether to reconnect.
    };

    ws.onclose = (event) => {
      console.warn(`[ws] closed code=${event.code} reason='${event.reason}' intentional=${isClosing}`);
      if (isClosing) return; // intentional shutdown (user stopped / session complete)
      // Unexpected drop — tell the UI and retry in 3 seconds.
      if (onReconnecting) onReconnecting();
      reconnectTimer = setTimeout(connect, 3000);
    };
  }

  connect();

  // Cleanup: stop reconnecting and close the socket for good.
  return function closeHifzSession() {
    isClosing = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (
      activeSocket &&
      (activeSocket.readyState === WebSocket.OPEN ||
        activeSocket.readyState === WebSocket.CONNECTING)
    ) {
      activeSocket.close();
    }
  };
}
