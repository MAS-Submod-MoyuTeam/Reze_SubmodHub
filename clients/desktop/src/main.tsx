import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { MotionProvider } from './components/Motion.tsx';
import './index.css';

// 与 Web 端一致：MotionProvider 必须在 App 外层，context 才覆盖所有浮层。
createRoot(document.getElementById('root')!).render(
  <MotionProvider>
    <App />
  </MotionProvider>
);
