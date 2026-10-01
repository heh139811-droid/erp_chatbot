import { Archive, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ChatThread, ConversationSearchResult } from '../types';

type ConversationItem = ChatThread | ConversationSearchResult;

interface Props {
  threads: ConversationItem[];
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
  onArchive: (threadId: string) => void;
}

const GROUPS = ['오늘', '어제', '최근 7일', '최근 30일'] as const;
type Group = (typeof GROUPS)[number];

export function ConversationList({ threads, selectedThreadId, onSelect, onArchive }: Props) {
  const grouped = groupThreads(threads);
  if (threads.length === 0) return <p className="p-5 text-center text-sm text-muted-foreground">아직 저장된 대화가 없습니다.</p>;
  return (
    <div className="space-y-4 pb-2">
      {GROUPS.map((group) => grouped[group].length > 0 ? (
        <section key={group}>
          <h2 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">{group}</h2>
          <div className="space-y-0.5">
            {grouped[group].map((thread) => (
              <div key={thread.id} className={cn('group flex items-center rounded-lg transition-colors hover:bg-sidebar-accent', thread.id === selectedThreadId && 'bg-sidebar-accent text-sidebar-accent-foreground')}>
                <button type="button" className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => onSelect(thread.id)}>
                  <span className="block truncate text-sm">{thread.title}</span>
                  <time className="mt-0.5 block text-[11px] text-muted-foreground" dateTime={thread.last_activity_at}>{formatTime(thread.last_activity_at)}</time>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="mr-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`${thread.title} 메뉴`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => onArchive(thread.id)}><Archive /> 보관하기</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </section>
      ) : null)}
    </div>
  );
}

function groupThreads(threads: ConversationItem[]): Record<Group, ConversationItem[]> {
  const groups: Record<Group, ConversationItem[]> = { 오늘: [], 어제: [], '최근 7일': [], '최근 30일': [] };
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const thread of threads) {
    const timestamp = new Date(thread.last_activity_at).getTime();
    const ageDays = Math.floor((startToday - timestamp) / 86_400_000);
    if (timestamp >= startToday) groups.오늘.push(thread);
    else if (ageDays <= 1) groups.어제.push(thread);
    else if (ageDays <= 7) groups['최근 7일'].push(thread);
    else groups['최근 30일'].push(thread);
  }
  return groups;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
