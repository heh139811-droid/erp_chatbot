import { useState } from 'react';
import Markdown from 'react-markdown';
import { Check, ChevronDown, Copy, Database, Filter, Sigma } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AnswerBasis, ChatMessage } from '../types';
import { StreamingIndicator } from './StreamingIndicator';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const [basisOpen, setBasisOpen] = useState(false);
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <article className="flex justify-end">
        <div className="message-prose max-w-[85%] rounded-3xl bg-muted px-5 py-2.5 text-sm leading-7 text-foreground md:max-w-[75%]">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </article>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <article className="group w-full">
      <div className="message-prose text-[15px] leading-7 text-foreground">
        {message.pending && !message.content ? <StreamingIndicator /> : <Markdown>{message.content}</Markdown>}
      </div>
      {!message.pending && message.content ? (
        <Collapsible open={basisOpen} onOpenChange={setBasisOpen} className="mt-2">
          <div className="flex h-8 items-center gap-1 text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copy()} aria-label="답변 복사">
                  {copied ? <Check /> : <Copy />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? '복사됨' : '답변 복사'}</TooltipContent>
            </Tooltip>
            {message.answer_basis?.length ? (
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2 text-xs" aria-label="답변 근거 보기">
                  <Database /> 답변 근거 보기
                  <ChevronDown className={`transition-transform ${basisOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            ) : null}
          </div>
          {message.answer_basis?.length ? (
            <CollapsibleContent className="pt-2">
              <div className="rounded-xl border bg-muted/35 p-4">
                <p className="mb-3 text-sm font-medium">이 답변은 다음 내용을 바탕으로 만들었습니다</p>
                <div className="space-y-4">
                  {message.answer_basis.map((basis, index) => (
                    <div key={basis.id}>
                      {index > 0 ? <Separator className="mb-4" /> : null}
                      <BasisDetails basis={basis} />
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      ) : null}
    </article>
  );
}

function BasisDetails({ basis }: { basis: AnswerBasis }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <strong>{basis.source_label}</strong>
          {basis.record_count !== null ? <Badge variant="secondary">{basis.record_count.toLocaleString('ko-KR')}건 확인</Badge> : null}
        </div>
        <p className="mt-1 leading-6 text-muted-foreground">{basis.explanation}</p>
      </div>
      {basis.period_label ? (
        <div className="flex gap-2">
          <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div><span className="font-medium">조회 범위</span><p className="text-muted-foreground">{basis.period_label}</p></div>
        </div>
      ) : null}
      {basis.conditions.length ? (
        <div className="flex gap-2">
          <Filter className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div><span className="font-medium">적용 조건</span><ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{basis.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></div>
        </div>
      ) : null}
      {basis.calculation ? (
        <div className="flex gap-2">
          <Sigma className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div><span className="font-medium">계산 기준</span><p className="text-muted-foreground">{basis.calculation}</p></div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">데이터 확인 시각: {formatBasisTime(basis.queried_at)}</p>
    </div>
  );
}

function formatBasisTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
