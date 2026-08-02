import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ChatCircleDots,
  PaperPlaneTilt,
  Pause,
  Play,
  Record,
  User,
  Waveform,
  X,
} from "@phosphor-icons/react";

const PHASE_LABELS = {
  idle: "语音待机",
  connecting: "正在连接…",
  listening: "正在听…",
  transcribing: "正在识别…",
  sending: "正在发送…",
  thinking: "正在思考…",
  speaking: "正在回复…",
  completed: "回答完成",
  paused: "已暂停",
  error: "出错了",
};

function formatTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function TextChatPanel({ snapshot, onClose, onSend }) {
  const [draft, setDraft] = useState("");
  const historyRef = useRef(null);
  const messages = snapshot.messages.slice(-24);
  const busy = ["thinking", "speaking"].includes(snapshot.phase)
    || messages.some((message) => message.status === "streaming");

  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [messages, snapshot.reply]);

  const submit = () => {
    if (busy || !draft.trim()) return;
    if (onSend(draft) !== false) setDraft("");
  };

  return (
    <section className="conversation-panel text-chat-panel" aria-label="与罗照月文字聊天" data-testid="text-chat-panel">
      <header className="conversation-header">
        <div>
          <span className="conversation-kicker">文字聊天</span>
          <h2>罗照月</h2>
        </div>
        <div className="conversation-presence" aria-label={busy ? "正在回复" : "在线"}>
          <i aria-hidden="true" />
          <span>{busy ? "正在回复" : "在线"}</span>
        </div>
        <button type="button" className="conversation-icon-button" onClick={onClose} aria-label="关闭文字聊天"><X weight="light" /></button>
      </header>

      <div className="message-history" ref={historyRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="message-empty">
            <ChatCircleDots weight="light" />
            <strong>想聊点什么？</strong>
            <span>罗照月会在这里陪着你。</span>
          </div>
        )}
        {messages.map((message) => (
          <article className={`message-row is-${message.role}`} key={message.id}>
            <div className="message-meta">
              <span>{message.role === "user" ? "你" : "罗照月"}</span>
              <time>{formatTime(message.createdAt)}</time>
            </div>
            <p>{message.content || (message.status === "streaming" ? "正在组织语言…" : "")}</p>
            {message.status === "streaming" && <span className="message-streaming" aria-label="回复生成中"><Waveform weight="light" /></span>}
          </article>
        ))}
        {snapshot.error && <div className="conversation-error" role="status">{snapshot.error}</div>}
      </div>

      <div className="chat-composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows="1"
          maxLength="1200"
          placeholder="说点什么…"
          aria-label="输入聊天消息"
        />
        <button type="button" className="chat-send-button" onClick={submit} disabled={busy || !draft.trim()} aria-label="发送消息">
          <PaperPlaneTilt weight="fill" />
        </button>
      </div>
      <span className="composer-hint">Enter 发送 · Shift + Enter 换行</span>
    </section>
  );
}

export function VoiceConversationPopover({ snapshot, portraitSrc, onPause, onResume, onEnd, onRetry }) {
  const paused = snapshot.phase === "paused";
  const recoverable = paused || snapshot.phase === "error";
  const turns = snapshot.voiceTurns || [];
  const currentTurn = turns.find((turn) => turn.turnId === snapshot.activeTurnId) || turns.at(-1);
  const currentTranscript = currentTurn?.transcriptFinal
    || currentTurn?.transcriptPartial
    || snapshot.transcript
    || snapshot.transcriptPartial
    || "";
  const assistantStatus = snapshot.reply || (snapshot.phase === "thinking" || snapshot.phase === "sending"
    ? "正在思考…"
    : snapshot.phase === "speaking" ? "正在回复…" : "");
  return (
    <section className={`conversation-panel voice-popover phase-${snapshot.phase}`} aria-label="简短语音对话" data-testid="voice-popover">
      <header className="voice-title-row">
        <strong>语音对话</strong>
        <Waveform weight="light" aria-hidden="true" />
      </header>

      <header className="voice-status-row">
        <span className="voice-status-icon" aria-hidden="true"><Record weight="duotone" /></span>
        <strong>{PHASE_LABELS[snapshot.phase] ?? PHASE_LABELS.idle}</strong>
        <Waveform className="voice-live-wave" weight="light" aria-hidden="true" />
      </header>
      <span className="voice-debug-state" data-testid="voice-debug-state" aria-hidden="true">{snapshot.voiceState || "Idle"}</span>

      <div className="voice-caption-list" aria-live="polite" data-testid="voice-caption-list">
        <div className={`voice-caption-turn is-${currentTurn?.status || snapshot.phase}`} data-turn-id={currentTurn?.turnId || undefined}>
          <User weight="light" aria-hidden="true" />
          <div>
            <span className={currentTurn?.transcriptPartial && !currentTurn?.transcriptFinal ? "voice-caption-partial" : "voice-caption-final"}>
              {currentTranscript || (snapshot.phase === "connecting" ? "正在连接麦克风…" : "请说话，我在听。")}
            </span>
            {currentTurn?.status === "send_failed" && (
              <span className="voice-caption-failure">
                发送失败，可重试
                <button type="button" onClick={() => onRetry?.(currentTurn.turnId)}>重试</button>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="voice-line is-assistant">
        <span className="voice-reply-avatar" aria-hidden="true"><img src={portraitSrc} alt="" draggable="false" /></span>
        <span>{assistantStatus || "罗照月的回答会显示在这里。"}</span>
      </div>

      {snapshot.error && <div className="conversation-error" role="status">{snapshot.error}</div>}
      <footer className="voice-popover-footer">
        <span><ArrowCounterClockwise weight="light" aria-hidden="true" />回复后继续倾听</span>
        <div>
          <button type="button" className="voice-control-button" onClick={recoverable ? onResume : onPause} aria-label={recoverable ? "继续语音对话" : "暂停语音对话"}>
            {recoverable ? <Play weight="fill" /> : <Pause weight="fill" />}
          </button>
          <button type="button" className="voice-control-button is-end" onClick={onEnd} aria-label="结束语音对话"><X weight="bold" /></button>
        </div>
      </footer>
    </section>
  );
}
