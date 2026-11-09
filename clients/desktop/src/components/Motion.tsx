/**
 * motion 的接入点（桌面 / Android 客户端）。
 *
 * 与 Web 站点那份是同一套约定（`LazyMotion` + `domAnimation` + `strict`、
 * `MotionConfig reducedMotion="user"`）。客户端与 Web 各存一份：
 * `motion` 只装在两端各自的 `node_modules` 里，`ui/` 共享目录解析不到它。
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
