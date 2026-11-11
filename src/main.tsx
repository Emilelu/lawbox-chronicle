import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './view/debug/lawboxDebug'; // DEV 调试句柄（window.__lawboxDebug，生产构建零副作用）

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root 容器不存在 —— 请检查 index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
