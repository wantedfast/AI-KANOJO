import { SCRIBE_MODEL_ID } from "../shared/model-contracts.js";

function downsampleToPcm16(input, inputRate, outputRate = 16000) {
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const output = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export class RealtimeScribe {
  constructor({ token, deviceId, sourceStream = null, onPartial, onCommitted, onError, onStatus }) {
    this.token = token;
    this.deviceId = deviceId;
    this.sourceStream = sourceStream;
    this.onPartial = onPartial;
    this.onCommitted = onCommitted;
    this.onError = onError;
    this.onStatus = onStatus;
  }

  async start() {
    try {
      this.onStatus?.("requesting");
      this.stream = this.sourceStream || await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
      this.onStatus?.("connecting");
      const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
      url.searchParams.set("model_id", SCRIBE_MODEL_ID);
      url.searchParams.set("audio_format", "pcm_16000");
      url.searchParams.set("commit_strategy", "vad");
      url.searchParams.set("vad_silence_threshold_secs", "1.2");
      url.searchParams.set("token", this.token);
      this.socket = new WebSocket(url);
      this.socket.onopen = () => this.onStatus?.("listening");
      this.socket.onmessage = ({ data }) => {
        const event = JSON.parse(data);
        if (event.message_type === "partial_transcript") this.onPartial?.(event.text ?? "");
        if (event.message_type === "committed_transcript") {
          this.onCommitted?.(event.text ?? "", event.id ?? `${event.text}-${event.timestamp ?? ""}`);
        }
        if (event.message_type?.includes("error") || event.error) {
          const message = event.error ?? event.message_type;
          this.stop();
          this.onError?.(message);
        }
      };
      this.socket.onerror = () => {
        this.stop();
        this.onError?.("Scribe 实时连接失败");
      };

      this.audioContext = new AudioContext();
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        if (this.socket?.readyState !== WebSocket.OPEN) return;
        const pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), this.audioContext.sampleRate);
        this.socket.send(JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: toBase64(pcm.buffer),
        }));
      };
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  setMuted(muted) {
    this.stream?.getAudioTracks?.().forEach((track) => { track.enabled = !muted; });
  }

  stop() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true }));
    }
    this.socket?.close();
    this.source?.disconnect();
    this.processor?.disconnect();
    this.audioContext?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.socket = null;
    this.source = null;
    this.processor = null;
    this.audioContext = null;
    this.stream = null;
    this.onStatus?.("idle");
  }
}

export { downsampleToPcm16 };
