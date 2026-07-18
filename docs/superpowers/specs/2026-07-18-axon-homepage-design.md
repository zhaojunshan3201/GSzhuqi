# Axon 新增主页设计

## 目标

为现有生产动态分析系统增加一个首次进入时展示的 Axon 全屏营销主页；用户点击主按钮后进入现有业务仪表盘。既有仪表盘及其数据请求、导航和业务功能保持不变。

## 范围与入口行为

- 应用加载时先渲染 Axon 落地页，不新增 URL 路由。
- 点击 **Get Early Access** 后，仅在前端状态中切换到既有系统主界面。
- 刷新浏览器后回到 Axon 主页。
- 顶部导航链接为展示性锚点，不新增页面或业务功能。

## 视觉与组件

- 页面由一个 `relative h-screen w-full overflow-hidden flex flex-col` 的 Hero 组成。
- 使用指定 CloudFront MP4 作为绝对定位的循环静音背景视频；视频 `object-cover object-top` 且高度为容器的 130%。
- 所有可见内容使用 `relative z-10`：半透明玻璃导航栏、YC 徽标、两行 Instrument Serif 标题、说明文字和 CTA。
- 加载 Google Fonts 的 Instrument Serif（常规、斜体）和 Inter（400、500、600）。正文文字颜色为 `#1B133C`。
- 页面 `<title>` 为 `Axon — Digital Workers for Mundane Workflows`。

## 集成方式

- 在 `src/App.tsx` 顶层增加一个局部 `AxonLandingPage` 组件和 `showLanding` 布尔状态。
- 当 `showLanding` 为真时提前返回首页；CTA 将其设为假，随后执行现有 `App` 的原始渲染路径。
- 在 `src/index.css` 增加字体导入和最小的全局 body 字体/颜色规则，不修改现有业务界面的 Tailwind 组件类。

## 可访问性与响应式

- CTA 使用原生 `button`，提供可见文本及键盘可操作性。
- 视频使用 `aria-hidden="true"`；正文区域保留正常语义结构。
- 小屏隐藏导航链接，保留 Logo、徽标、标题和 CTA；按照给定的 Tailwind 断点调整字号与间距。

## 验证

- `npm run lint` 无 TypeScript 错误。
- `npm run build` 成功构建。
- 浏览器打开首页时视频、文字与 CTA 正常显示；点击 CTA 后能进入原有仪表盘。
