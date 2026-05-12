// MQTT-over-WSS signaling using a public broker. Payloads are AES-GCM
// envelopes built by crypto.js. Two sides agree on a roomId derived from
// the same passphrase and use 4 sub-topics.

import { encryptJson, decryptJson } from './crypto.js';

const BROKER = 'wss://broker.emqx.io:8084/mqtt';

export function createSignaling({ roomId, key, role, onMessage, onState }) {
  const myTag = role === 'pc' ? 'a' : 'b';
  // PC publishes offer + ice-a, listens to answer + ice-b.
  // iPad publishes answer + ice-b, listens to offer + ice-a.
  const pubTopics = role === 'pc'
    ? { offer: `geofs/${roomId}/offer`, ice: `geofs/${roomId}/ice-a`, telemetry: `geofs/${roomId}/telemetry`, control: null }
    : { answer: `geofs/${roomId}/answer`, ice: `geofs/${roomId}/ice-b`, telemetry: null, control: `geofs/${roomId}/control` };
  const subTopics = role === 'pc'
    ? [`geofs/${roomId}/answer`, `geofs/${roomId}/ice-b`, `geofs/${roomId}/control`]
    : [`geofs/${roomId}/offer`, `geofs/${roomId}/ice-a`, `geofs/${roomId}/telemetry`];

  const clientId = `geofs-${role}-${Math.random().toString(16).slice(2, 10)}`;
  const client = mqtt.connect(BROKER, {
    clientId,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
  });

  client.on('connect', () => {
    onState && onState('mqtt-connected');
    client.subscribe(subTopics, { qos: 0 });
  });
  client.on('reconnect', () => onState && onState('mqtt-reconnecting'));
  client.on('error', err => onState && onState('mqtt-error', err.message));
  client.on('close',  () => onState && onState('mqtt-closed'));

  client.on('message', async (topic, payload) => {
    const obj = await decryptJson(key, payload.toString());
    if (!obj) return; // wrong key or noise
    const kind = topic.split('/').pop();
    onMessage(kind, obj);
  });

  async function publish(kind, obj) {
    const topic = `geofs/${roomId}/${kind}`;
    const env = await encryptJson(key, obj);
    client.publish(topic, env, { qos: 0, retain: false });
  }

  function close() {
    try { client.end(true); } catch (_) {}
  }

  return { publish, close };
}
