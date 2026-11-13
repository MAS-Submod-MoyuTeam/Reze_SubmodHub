import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 模组正文本身就是 Markdown，没有界面文案；唯一需要本地化的是空链接（只有图标、
// 没有可见文字时）的无障碍名称，所以这里允许调用方传入一个现成的 `t()`，
// 纯组件本身不依赖任何 hook，孤立测试照旧可以直接渲染。
export interface MarkdownTextProps {
  value: string;
  className?: string;
  /** 无可见文字的链接的无障碍名称；调用方传入 `t('...')`。 */
  linkLabel?: string;
}

const plugins = [remarkGfm];

/** 工厂而不是常量：链接的无障碍名称随 UI 语言变化。 */
const buildComponents = (linkLabel?: string): Components => ({
  pre: ({ children }) => <pre className="max-w-full overflow-x-auto whitespace-pre rounded border border-neutral-200 bg-neutral-100 p-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
  code: ({ children, className }) => <code className={`rounded bg-neutral-200 px-1 py-0.5 font-mono text-[0.9em] ${className || ''}`}>{children}</code>,
  a: ({ children, href, node }) => {
    // 只有图标、没有可见文字的链接，读屏器会念出裸 URL；给一个本地化的名称。
    const visible = Boolean(node?.children?.some((child) => child.type === 'text' && child.value.trim()));
    const label = visible ? undefined : linkLabel;
    return <a href={href} aria-label={label} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline break-words transition-colors rounded hover:text-sky-800 hover:bg-sky-50 active:bg-sky-100 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{children}</a>;
  },
  table: ({ children }) => <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-left [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1">{children}</table></div>,
  img: ({ src, alt }) => <img src={src} alt={alt || ''} loading="lazy" className="max-w-full rounded" />,
});

export const MarkdownText: React.FC<MarkdownTextProps> = ({ value, className = '', linkLabel }) => {
  const components = React.useMemo(() => buildComponents(linkLabel), [linkLabel]);
  return <div className={`min-w-0 space-y-2 break-words [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-500 [&_hr]:border-neutral-200 ${className}`}>
    <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>{value}</ReactMarkdown>
  </div>;
};
