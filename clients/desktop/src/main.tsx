import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { MotionProvider } from './components/Motion.tsx';
import { LangProvider } from './i18n';
import './index.css';

// 与 Web 端一致：MotionProvider 必须在 App 外层，context 才覆盖所有浮层。
// LangProvider 再包一层：语言在整棵树上都可用，切换时所有文案一起更新。
createRoot(document.getElementById('root')!).render(
  <LangProvider>
    <MotionProvider>
      <App />
    </MotionProvider>
  </LangProvider>
);
