import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { MotionProvider } from './components/Motion.tsx';
import { LangProvider } from './i18n';
import './index.css';

// MotionProvider 必须包在 App 外层：`LazyMotion strict` 与 `MotionConfig`
// 都是靠 context 下发的，只有位于所有浮层之上才真正生效。
// LangProvider 同样必须包在最外层：语言状态是全局唯一来源，一旦漏包，
// useI18n 会静默退回「永远中文」的默认实现，切换器看起来点了没反应。
createRoot(document.getElementById('root')!).render(
  <LangProvider>
    <MotionProvider>
      <App />
    </MotionProvider>
  </LangProvider>
);
