import { ArrowCounterClockwise, ImageSquare, UploadSimple } from "@phosphor-icons/react";
import { CHARACTER_ASSET_STATES, DEFAULT_CHARACTER_ASSETS } from "../shared/character-assets.js";

const STATE_LABELS = {
  idle: "休眠",
  listening: "倾听",
  thinking: "思考",
  completed: "完成",
};

export function CharacterAssetsManager({ assets, busyKey, note, onImport, onReset }) {
  const portraitSrc = assets.portrait?.src || DEFAULT_CHARACTER_ASSETS.portrait;
  return (
    <section className="character-assets-manager" aria-labelledby="character-assets-heading">
      <div className="asset-manager-heading">
        <div>
          <span className="eyebrow">CHARACTER ASSETS</span>
          <h2 id="character-assets-heading">角色资产</h2>
        </div>
        <span className="asset-manager-note" role="status">{note || "右键胶囊可随时打开设置 · 单张不超过 12MB"}</span>
      </div>

      <div className="asset-manager-grid">
        <article className="portrait-asset-card">
          <div className="asset-preview portrait-asset-preview"><img src={portraitSrc} alt="当前 2D 立绘预览" /></div>
          <div className="asset-card-copy">
            <span>会话立绘</span>
            <strong>{assets.portrait?.customized ? assets.portrait.fileName : "Modern JK 默认立绘"}</strong>
            <small>语音和文字会话打开时显示</small>
          </div>
          <div className="asset-card-actions">
            <button type="button" aria-label="替换会话立绘" onClick={() => onImport({ type: "portrait" })} disabled={Boolean(busyKey)}><UploadSimple />{busyKey === "portrait" ? "导入中" : "替换"}</button>
            {assets.portrait?.customized && <button type="button" aria-label="恢复默认会话立绘" className="is-quiet" onClick={() => onReset({ type: "portrait" })} disabled={Boolean(busyKey)}><ArrowCounterClockwise />默认</button>}
          </div>
        </article>

        <article className="pixel-assets-card">
          <div className="pixel-assets-title"><ImageSquare /><span><strong>8-bit 状态图</strong><small>逐个替换，不改变 160px 显示比例</small></span></div>
          <div className="pixel-assets-grid">
            {CHARACTER_ASSET_STATES.map((state) => {
              const asset = assets.states?.[state];
              const src = asset?.src || DEFAULT_CHARACTER_ASSETS.states[state];
              return (
                <div className="pixel-asset-item" key={state}>
                  <div className="pixel-asset-preview"><img src={src} alt={`${STATE_LABELS[state]} 8-bit 预览`} /></div>
                  <span>{STATE_LABELS[state]}</span>
                  <button type="button" aria-label={`替换${STATE_LABELS[state]} 8-bit 状态图`} onClick={() => onImport({ type: "state", state })} disabled={Boolean(busyKey)}>{busyKey === state ? "导入中" : "替换"}</button>
                </div>
              );
            })}
          </div>
          {CHARACTER_ASSET_STATES.some((state) => assets.states?.[state]?.customized) && (
            <button type="button" aria-label="恢复默认 8-bit 状态图" className="reset-pixel-assets" onClick={() => onReset({ type: "states" })} disabled={Boolean(busyKey)}><ArrowCounterClockwise />恢复默认 8-bit</button>
          )}
        </article>
      </div>
    </section>
  );
}
