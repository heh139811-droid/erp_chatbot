import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import type { ChatThread, ConversationSearchResult } from '../types';
import { ConversationList } from './ConversationList';

interface Props {
  threads: ChatThread[];
  selectedThreadId?: string;
  loading: boolean;
  searching: boolean;
  searchResults: ConversationSearchResult[];
  hasMore: boolean;
  onNew: () => void;
  onLoadMore: () => void;
  onSearch: (query: string) => void;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => Promise<void>;
}

export function ConversationSidebar(props: Props) {
  const [query, setQuery] = useState('');
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => props.onSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query, props.onSearch]);
  useEffect(() => {
    const target = loadMoreRef.current;
    const root = target?.closest('[data-slot="scroll-area-viewport"]');
    if (!target || !root || !props.hasMore || props.loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) props.onLoadMore(); },
      { root, rootMargin: '0px 0px 200px 0px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [props.hasMore, props.loading, props.onLoadMore]);

  return (
    <aside className="flex h-full flex-col text-sidebar-foreground" aria-label="대화 목록">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <div className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">W</div>
        <div>
          <p className="text-sm font-semibold leading-none">WJ ERP Chat</p>
          <p className="mt-1 text-xs text-muted-foreground">업무용 AI</p>
        </div>
      </div>
      <Separator />
      <div className="p-3">
        <Button className="w-full justify-start" variant="outline" onClick={props.onNew}>
          <MessageSquarePlus /> 새 대화
        </Button>
      </div>
      <div className="relative px-3 pb-3">
        <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" placeholder="내 대화 검색" aria-label="내 대화 검색" />
      </div>
      <ScrollArea className="min-h-0 min-w-0 flex-1 px-2">
        <div className="w-full min-w-0 overflow-hidden">
          <ConversationList threads={query.trim() ? props.searchResults : props.threads} selectedThreadId={props.selectedThreadId} onSelect={props.onSelect} onDelete={props.onDelete} />
        </div>
        {props.searching ? <div className="p-2"><Skeleton className="h-10 w-full" /></div> : null}
        {props.loading ? (
          <div className="space-y-2 p-2" aria-label="대화 목록 불러오는 중">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-4/5" />
          </div>
        ) : null}
        {!query.trim() && props.hasMore ? <div ref={loadMoreRef} className="h-px" aria-hidden="true" /> : null}
        {!query.trim() && !props.hasMore && props.threads.length > 0 ? <p className="p-3 text-center text-xs text-muted-foreground">최근 30일 대화를 모두 불러왔습니다.</p> : null}
      </ScrollArea>
      <div className="border-t p-3 text-xs text-muted-foreground">대화는 30일 후 자동 삭제됩니다.</div>
    </aside>
  );
}
