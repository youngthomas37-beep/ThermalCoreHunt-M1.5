# Thermal Core Hunt

M1.5 · 多热气流、随风漂移、随机布局、高度与云底。纯前端，无后端。

**在线试玩**：<https://youngthomas37-beep.github.io/ThermalCoreHunt-M1.5/>
**源码仓库**：<https://github.com/youngthomas37-beep/ThermalCoreHunt-M1.5>

## 运行

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5199
```

其他命令：

```bash
pnpm build      # tsc --noEmit + vite build
pnpm sim        # 无头物理校验，输出 out/simcheck.json
node tools/shot.mjs <url> <out.png>   # 无头截图
```

## 发布到 GitHub Pages

```powershell
$env:VITE_BASE = '/ThermalCoreHunt-M1.5/'
pnpm exec vite build --outDir docs
```

`docs/` 是 Pages 的发布目录（仓库 Settings → Pages → Deploy from branch `main` / `/docs`）。

## 操作

| 输入 | 作用 |
|---|---|
| 左/右刹车滑块 | 向下拉，拉得越深转弯越急（45° 上限、指数曲线） |
| `←` / `→` 或 `A` / `D` | 左/右刹车 |
| `H` 或顶部按钮 | 隐藏 / 显示气流图 |
| `R` | 换一个随机种子重开 |
| `M` | 静音 |
| 底部风面板 | 2/4/6 m/s + 九宫格风向（中间 = 无风） |

## 玩法

- 四个场景：教学 300→800 m、标准 500→1100 m、强天 500→1500 m、低空挑战 100→900 m。
- 爬升到云底并停留 **10 秒** 通关；高度归零触地结束。
- 无操作 20 秒提示、45 秒自动驾驶演示、2 分钟结束。
- 热气流可能是圆形、椭圆或条带，数量与分布每局随机；会以 0.35 倍风速漂移。

## 结构

```
src/core
  field.ts      多 lobe 热气流、叠加软饱和、高度切片、风漂移、质量补偿
  generator.ts  约束随机：数量/间距/覆盖率/起点
  glider.ts     2D 地面参考系 + 高度、45° 坡度、指数输入曲线
  sim.ts        固定步长 120 Hz、vario 平均/延迟/噪声、云底/触地/热气流计数
  autopilot.ts  演示与校验用（0.6R 盘旋）
src/render      地形、热力图纹理、轨迹、翼尖抖动
src/audio       Web Audio vario
tools           simcheck / 截图 / 探针
```

## 说明

- 当前是 **固定切片**（A 版）：整局使用起始高度的水平切片。`field.ts` 已支持按 z 取剖面（`fixed=false`），B 版留给 v1.5。
- 热气流漂移系数固定 0.35；挑战模式尚未锁定风与场景。
- 还没有计分、排行榜、复盘与真机触觉反馈。
