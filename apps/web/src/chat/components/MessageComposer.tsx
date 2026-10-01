import { useState, type KeyboardEvent } from 'react';
import { ArrowUp, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  disabled: boolean;
  onSend: (content: string) => Promise<void>;
}

export function MessageComposer({ disabled, onSend }: Props) {
  const [value, setValue] = useState('');
  const submit = async () => {
    const content = value.trim();
    if (!content || disabled) return;
    setValue('');
    await onSend(content);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-3 pb-3 pt-2 md:px-6 md:pb-5">
      <div className="mx-auto max-w-3xl">
        <Card className="flex-row items-end gap-2 rounded-2xl p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            maxLength={20_000}
            placeholder="ERP 업무에 관해 질문하세요"
            aria-label="메시지 입력"
            className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 shadow-none focus-visible:ring-0"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon" className="shrink-0 rounded-xl" onClick={() => void submit()} disabled={disabled || !value.trim()} aria-label="메시지 전송">
                {disabled ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>전송 · Enter</TooltipContent>
          </Tooltip>
        </Card>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">AI 응답은 실제 ERP 데이터와 다를 수 있으므로 중요한 내용은 확인해 주세요.</p>
      </div>
    </div>
  );
}
