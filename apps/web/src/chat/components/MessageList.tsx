import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const update = () => {
      nearBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
    };
    viewport.addEventListener('scroll', update, { passive: true });
    return () => viewport.removeEventListener('scroll', update);
  }, []);
  useEffect(() => {
    if (nearBottomRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <ScrollArea ref={scrollRootRef} className="min-h-0 flex-1">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 md:px-6 md:py-10">
        {messages.length === 0 ? (
          <div className="m-auto flex max-w-lg flex-col items-center py-16 text-center">
            <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><Sparkles className="size-5" /></div>
            <Badge variant="secondary" className="mb-3">ERP AI Assistant</Badge>
            <h1 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">무엇을 도와드릴까요?</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">사내 ERP 업무와 데이터에 관해 질문해 주세요. 본인의 대화만 안전하게 저장됩니다.</p>
          </div>
        ) : (
          <div className="space-y-7">
            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
