/**
 * motion 的接入点（Web 站点）。
 *
 * 两件事：
 * 1. 用 `LazyMotion` + `domAnimation` 而不是全量 `motion` 组件——实测 gzip 从
 *    +40.6 KB 降到 +27.5 KB。`strict` 保证误用 `motion.div` 会直接报错，
 *    避免有人悄悄把全量实现又引回来。
 * 2. 统一 `MotionConfig reducedMotion="user"`：系统开了「减少动态效果」时，
 *    motion 自动跳过位移与缩放，只保留透明度变化。
 *
 * 导出的 `m` 是 `LazyMotion` 下的轻量组件；`AnimatePresence` 直接转出。
 * 业务组件从这里拿，不要直接 `import { motion } from 'motion/react'`。
 */
import React from 'react';
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from 'motion/react';

export { AnimatePresence, m };

/** 应用根节点包一层，`m.*` 才能拿到动画特性。 */
export const MotionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  </LazyMotion>
);
