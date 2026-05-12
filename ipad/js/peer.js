// WebRTC peer with two DataChannels (telemetry unreliable, control reliable),
// driven by signaling messages from signaling.js. The iPad is the answerer.

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export function createAnswerPeer({ signaling, onOpen, onClose, onTelemetry, onState }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let telemetryCh = null;
  let controlCh = null;
  let pendingIce = [];
  let remoteSet = false;
  let queuedControl = [];

  pc.onicecandidate = e => {
    if (e.candidate) signaling.publish('ice-b', e.candidate.toJSON());
  };
  pc.oniceconnectionstatechange = () => {
    onState && onState('ice', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') onClose && onClose('ice-failed');
  };
  pc.onconnectionstatechange = () => {
    onState && onState('rtc', pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      // Allow some recovery before declaring closed
      setTimeout(() => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          onClose && onClose(pc.connectionState);
        }
      }, 5000);
    }
  };
  pc.ondatachannel = e => {
    const ch = e.channel;
    if (ch.label === 'telemetry') {
      telemetryCh = ch;
      ch.binaryType = 'arraybuffer';
      ch.onmessage = ev => onTelemetry && onTelemetry(ev.data);
    } else if (ch.label === 'control') {
      controlCh = ch;
      ch.onopen = () => {
        // Flush anything queued before the channel opened
        while (queuedControl.length) ch.send(queuedControl.shift());
        onOpen && onOpen();
      };
      ch.onclose = () => onClose && onClose('control-closed');
    }
  };

  async function handleOffer(sdp) {
    await pc.setRemoteDescription({ type: 'offer', sdp });
    remoteSet = true;
    for (const c of pendingIce) {
      try { await pc.addIceCandidate(c); } catch (_) {}
    }
    pendingIce = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.publish('answer', { sdp: answer.sdp });
  }

  async function handleRemoteIce(c) {
    if (!remoteSet) { pendingIce.push(c); return; }
    try { await pc.addIceCandidate(c); } catch (_) {}
  }

  function sendControl(cmd, value) {
    const msg = JSON.stringify(value === undefined ? { cmd } : { cmd, value });
    if (controlCh && controlCh.readyState === 'open') controlCh.send(msg);
    else queuedControl.push(msg);
  }

  function close() {
    try { pc.close(); } catch (_) {}
  }

  return { pc, handleOffer, handleRemoteIce, sendControl, close };
}

export function createOfferPeer({ signaling, onOpen, onClose, onControl, onState, telemetryProvider }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let pendingIce = [];
  let remoteSet = false;

  const telemetryCh = pc.createDataChannel('telemetry', {
    ordered: false, maxRetransmits: 0,
  });
  telemetryCh.binaryType = 'arraybuffer';
  const controlCh = pc.createDataChannel('control', { ordered: true });
  controlCh.onmessage = e => {
    try { onControl && onControl(JSON.parse(e.data)); } catch (_) {}
  };

  pc.onicecandidate = e => {
    if (e.candidate) signaling.publish('ice-a', e.candidate.toJSON());
  };
  pc.oniceconnectionstatechange = () => {
    onState && onState('ice', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') onClose && onClose('ice-failed');
  };
  pc.onconnectionstatechange = () => onState && onState('rtc', pc.connectionState);

  let telemetryReady = false;
  telemetryCh.onopen = () => {
    telemetryReady = true;
    onOpen && onOpen();
  };
  telemetryCh.onclose = () => onClose && onClose('telemetry-closed');

  async function start() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signaling.publish('offer', { sdp: offer.sdp });
  }

  async function handleAnswer(sdp) {
    await pc.setRemoteDescription({ type: 'answer', sdp });
    remoteSet = true;
    for (const c of pendingIce) {
      try { await pc.addIceCandidate(c); } catch (_) {}
    }
    pendingIce = [];
  }

  async function handleRemoteIce(c) {
    if (!remoteSet) { pendingIce.push(c); return; }
    try { await pc.addIceCandidate(c); } catch (_) {}
  }

  function sendTelemetry(buf) {
    if (telemetryReady && telemetryCh.readyState === 'open') {
      try { telemetryCh.send(buf); } catch (_) {}
    }
  }

  function close() {
    try { pc.close(); } catch (_) {}
  }

  return { pc, start, handleAnswer, handleRemoteIce, sendTelemetry, close };
}
