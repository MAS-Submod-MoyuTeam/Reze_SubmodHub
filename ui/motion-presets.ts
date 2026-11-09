/**
 * 共享动效预设（Web 站点与桌面/Android 客户端共用）。
 *
 * 退场期间的指针屏蔽不放这里：`pointer-events` 在动画帧里不可靠，
 * 由组件挂 Tailwind 的 `pointer-events-none` 类，语义更直白也更好测。
 *
 * 这里只放纯数据：缓动曲线、时长、以及各语义浮层的 `initial/animate/exit` 变体。
 * 不导入 `motion` 本体——`ui/` 目录在两端各自的 `node_modules` 之外，解析不到它，
 * 真要引入就会在仓库根部再装一份，运行时出现两个 motion 实例，
 * `MotionConfig` / `LazyMotion` 的上下文会断开。封装留在两端各自的 `Motion.tsx`。
 *
 * 命名按语义而不是按形状：`drawer` 永远是从右侧滑入，`toast` 永远是从下方浮起。
 * 组件只声明「我是什么」，改手感时只改这一处。
 */

/** 进入：快出缓停，观感上是「弹出来」。 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** 退出：加速离开。退出拖太久会让人以为点击没生效。 */
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** 时长（秒）。与 `motion` 的 `transition.duration` 单位一致。 */
export const DURATION = {
  overlay: 0.16,
  panel: 0.18,
  drawer: 0.22,
  toast: 0.18,
  dropdown: 0.14,
  /** 退出统一比进入短一档。 */
  out: 0.14,
} as const;

/**
 * 遮罩：只做透明度。整屏层做位移会让人误以为页面在晃。
 */
export const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.overlay, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION.out, ease: EASE_IN } },
} as const;

/**
 * 居中弹窗：轻微上浮 + 微缩放。
 * 位移只有 6px，短屏上不会把标题推出视口。
 */
export const panelVariants = {
  initial: { opacity: 0, y: 6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.panel, ease: EASE_OUT } },
  exit: { opacity: 0, y: 6, scale: 0.97, transition: { duration: DURATION.out, ease: EASE_IN } },
} as const;

/**
 * 右侧抽屉：整块从右边缘滑入。
 *
 * `initial` 与 `animate` 必须是同一单位。写成 `x: '100%'` → `x: 0` 时，
 * motion 无法在百分比与像素之间插值，会直接放弃动画、把元素留在初始帧，
 * 表现就是「抽屉打不开」。这里统一用 `%`：`animate` 也写 `'0%'`。
 */
export const drawerVariants = {
  initial: { x: '100%' },
  animate: { x: '0%', transition: { duration: DURATION.drawer, ease: EASE_OUT } },
  exit: { x: '100%', transition: { duration: DURATION.out + 0.04, ease: EASE_IN } },
} as const;

/**
 * Toast / 非模态提示条：从下方 8px 浮上来，退出时原路退回。
 */
export const toastVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.toast, ease: EASE_OUT } },
  exit: { opacity: 0, y: 8, transition: { duration: DURATION.out, ease: EASE_IN } },
} as const;

/**
 * 下拉面板：贴在被点元素下方，向上收起 4px 比向下更有「收进按钮」的感觉。
 */
export const dropdownVariants = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.dropdown, ease: EASE_OUT } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: DURATION.out, ease: EASE_IN } },
} as const;

/**
 * 已经打开的面板内部新出现的一块内容（例如异步拿到的下载信息）。
 *
 * 不做缩放：这类内容在文档流里占位，缩放会让周围文字跟着抖一下。
 */
export const inlineVariants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.panel, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION.out, ease: EASE_IN } },
} as const;
