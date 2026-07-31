# AI-KANOJO 资产清单

## Reference

| 内容 | 路径 | 用途 |
|---|---|---|
| 常驻休眠胶囊 | `ui-concepts/01-dynamic-island.png` | 默认桌面态 |
| 桌面宠物关系 | `ui-concepts/02-desktop-pet.png` | 角色与胶囊位置 |
| 空间玻璃详情 | `ui-concepts/03-vision-space.png` | 展开详情 |
| 角色动作语言 | `ui-concepts/04-japanese-assistant.png` | 状态动作 |
| 设置与诊断 | `ui-concepts/05-future-core.png` | 设置面板 |
| 监听生产力状态 | `ui-concepts/06-productivity.png` | 监听/思考/说话 |
| 光谱长胶囊定稿 | `ui-concepts/07-spectrum-capsule.png` | 当前 UI 唯一视觉基准 |
| 罗照月 v005 | `character/luo-zhaoyue/source/luo-zhaoyue-lookdev-v005.png` | 唯一身份标准 |
| 旧三视图 | `character/luo-zhaoyue/source/luo-zhaoyue-legacy-turnaround.png` | 仅作结构参考 |

## Runtime

| 状态 | 路径 | 说明 |
|---|---|---|
| idle | `../public/avatar/8bit/states/idle.png` | 休眠关键姿势 |
| listening | `../public/avatar/8bit/states/listening.png` | 聆听关键姿势 |
| thinking | `../public/avatar/8bit/states/thinking.png` | 思考关键姿势 |
| completed | `../public/avatar/8bit/states/completed.png` | 完成关键姿势 |

状态到图片、动画和锚点的唯一映射是 `../public/avatar/8bit/manifest.json`。

六套服装预览位于 `../public/avatar/outfits/front/`。它们是造型选择参考，不代表已经具备完整 8-bit 状态集。

## 已知缺口

- 尚无独立 `speaking` 图，首版复用 `listening.png`。
- 尚无独立 `error` 图，首版复用 `thinking.png`。
- 四张运行图是关键姿势，不是完整逐帧动画。
- 原始画布尺寸不同，运行时必须使用清单锚点统一脚底与胶囊位置。
