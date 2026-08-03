export const STATE_META = {
  idle: { label: "休眠", hint: "点击照月开始对话", src: "./avatar/8bit/states/idle.png", animation: "sleep-breathe", seatAnchor: 1 },
  listening: { label: "正在听", hint: "请继续，我在听", src: "./avatar/8bit/states/listening.png", animation: "listen-pulse", seatAnchor: 0.55 },
  thinking: { label: "正在想", hint: "让我想一想……", src: "./avatar/8bit/states/thinking.png", animation: "thinking-flicker", seatAnchor: 0.58 },
  speaking: { label: "正在说", hint: "正在用 Eleven v3 回答", src: "./avatar/8bit/states/listening.png", animation: "speech-bob", seatAnchor: 0.55 },
  completed: { label: "完成", hint: "很高兴和你聊天", src: "./avatar/8bit/states/completed.png", animation: "happy-bounce", seatAnchor: 0.57 },
  error: { label: "需要注意", hint: "连接遇到问题", src: "./avatar/8bit/states/thinking.png", animation: "error-shake", seatAnchor: 0.58 },
};
