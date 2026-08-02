export const CHARACTER_ASSET_STATES = ["idle", "listening", "thinking", "completed"];

export const DEFAULT_CHARACTER_ASSETS = {
  portrait: "./avatar/outfits/front/02-modern-jk-conversation.png",
  states: {
    idle: "./avatar/8bit/states/idle.png",
    listening: "./avatar/8bit/states/listening.png",
    thinking: "./avatar/8bit/states/thinking.png",
    completed: "./avatar/8bit/states/completed.png",
  },
};

export const normalizeCharacterAssetState = (state) => (
  CHARACTER_ASSET_STATES.includes(state) ? state : null
);

export const visualStateAssetKey = (state) => {
  if (state === "speaking") return "listening";
  if (state === "error") return "thinking";
  return normalizeCharacterAssetState(state) || "idle";
};
