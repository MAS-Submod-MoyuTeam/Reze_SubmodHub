import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components: Components = {
  pre: ({ children }) => <pre className="max-w-full overflow-x-auto whitespace-pre rounded border border-neutral-200 bg-neutral-100 p-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
  code: ({ children, className }) => <code className={`rounded bg-neutral-200 px-1 py-0.5 font-mono text-[0.9em] ${className || ''}`}>{children}</code>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline break-words">{children}</a>,
  table: ({ children }) => <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-left [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1">{children}</table></div>,
  img: ({ src, alt }) => <img src={src} alt={alt || ''} loading="lazy" className="max-w-full rounded" />,
};

export const MarkdownText: React.FC<{ value: string; className?: string }> = ({ value, className = '' }) => {
  return <div className={`min-w-0 space-y-2 break-words [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-500 [&_hr]:border-neutral-200 ${className}`}>
    <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>{value}</ReactMarkdown>
  </div>;
};
