import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ChatCircleDots,
  PaperPlaneTilt,
  Pause,
  Play,
  User,
  Waveform,
  X,
} from "@phosphor-icons/react";

const PHASE_LABELS = {
  idle: "语音待机",
  connecting: "正在连接…",
  listening: "正在听…",
  thinking: "思考中…",
  speaking: "正在说…",
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

export function VoiceConversationPopover({ snapshot, onPause, onResume, onEnd }) {
  const paused = snapshot.phase === "paused";
  return (
    <section className={`conversation-panel voice-popover phase-${snapshot.phase}`} aria-label="简短语音对话" data-testid="voice-popover">
      <header className="voice-status-row">
        <span className="voice-status-icon" aria-hidden="true"><Waveform weight="light" /></span>
        <strong>{PHASE_LABELS[snapshot.phase] ?? PHASE_LABELS.idle}</strong>
        <Waveform className="voice-live-wave" weight="light" aria-hidden="true" />
      </header>

      <div className="voice-line is-user">
        <User weight="light" aria-hidden="true" />
        <span>{snapshot.transcript || (snapshot.phase === "connecting" ? "正在连接麦克风…" : snapshot.phase === "listening" ? "请说话，我在听。" : "等待你的声音…")}</span>
      </div>
      <div className="voice-line is-assistant">
        <ChatCircleDots weight="light" aria-hidden="true" />
        <span>{snapshot.reply || (snapshot.phase === "thinking" ? "让我想一想…" : "罗照月的回答会显示在这里。")}</span>
      </div>

      {snapshot.error && <div className="conversation-error" role="status">{snapshot.error}</div>}
      <footer className="voice-popover-footer">
        <span><ArrowCounterClockwise weight="light" aria-hidden="true" />回复后继续倾听</span>
        <div>
          <button type="button" className="voice-control-button" onClick={paused ? onResume : onPause} aria-label={paused ? "继续语音对话" : "暂停语音对话"}>
            {paused ? <Play weight="fill" /> : <Pause weight="fill" />}
          </button>
          <button type="button" className="voice-control-button is-end" onClick={onEnd} aria-label="结束语音对话"><X weight="bold" /></button>
        </div>
      </footer>
    </section>
  );
}
