import Markdown from 'react-markdown';
import { Bot, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '../types';
import { StreamingIndicator } from './StreamingIndicator';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <article className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <Avatar className="mt-1 size-8 border">
        <AvatarFallback className={cn(isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground')}>
          {isUser ? <UserRound className="size-4" /> : <Bot className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <Card className={cn(
        'max-w-[min(88%,44rem)] gap-0 border-0 py-0 shadow-none',
        isUser ? 'rounded-2xl rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-2xl rounded-tl-sm bg-muted'
      )}>
        <CardContent className="message-prose px-4 py-3 text-sm leading-7">
          {!isUser && message.pending && !message.content
            ? <StreamingIndicator />
            : !isUser ? <Markdown>{message.content}</Markdown> : <p className="whitespace-pre-wrap">{message.content}</p>}
        </CardContent>
      </Card>
    </article>
  );
}
