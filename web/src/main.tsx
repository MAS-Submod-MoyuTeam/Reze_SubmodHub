import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { MotionProvider } from './components/Motion.tsx';
import './index.css';

// MotionProvider 必须包在 App 外层：`LazyMotion strict` 与 `MotionConfig`
// 都是靠 context 下发的，只有位于所有浮层之上才真正生效。
createRoot(document.getElementById('root')!).render(
  <MotionProvider>
    <App />
  </MotionProvider>
);
