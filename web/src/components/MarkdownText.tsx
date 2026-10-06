import React from 'react';

function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="px-1 py-0.5 bg-neutral-200 rounded font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export const MarkdownText: React.FC<{ value: string; className?: string }> = ({ value, className = '' }) => {
  const lines = value.split(/\r?\n/);
  return <div className={`space-y-1.5 ${className}`}>{lines.map((line, index) => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const Tag = heading[1].length === 1 ? 'h3' : heading[1].length === 2 ? 'h4' : 'h5'; return <Tag key={index} className="font-semibold text-neutral-900">{inline(heading[2])}</Tag>; }
    if (/^[-*]\s+/.test(line)) return <div key={index} className="pl-4 list-item list-disc">{inline(line.replace(/^[-*]\s+/, ''))}</div>;
    if (!line.trim()) return <div key={index} className="h-1" />;
    return <p key={index}>{inline(line)}</p>;
  })}</div>;
};
