export function capabilities(scope: typeof globalThis = globalThis) {
  const nav = 'navigator' in scope ? scope.navigator : undefined;
  return {
    webrtc: 'RTCPeerConnection' in scope, websocket: 'WebSocket' in scope,
    crypto: !!scope.crypto?.subtle, clipboard: !!nav?.clipboard?.writeText,
    camera: !!nav?.mediaDevices?.getUserMedia, notifications: 'Notification' in scope,
    share: !!nav?.share, serviceWorker: !!nav && 'serviceWorker' in nav,
    filePicker: 'document' in scope, streamSave: 'showSaveFilePicker' in scope,
    dragDrop: 'document' in scope && 'draggable' in scope.document.createElement('div')
  };
}
