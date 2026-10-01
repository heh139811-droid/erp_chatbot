import { useState } from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ChatThread, ConversationSearchResult } from '../types';

type ConversationItem = ChatThread | ConversationSearchResult;

interface Props {
  threads: ConversationItem[];
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => Promise<void>;
}

const GROUPS = ['오늘', '어제', '최근 7일', '최근 30일'] as const;
type Group = (typeof GROUPS)[number];

export function ConversationList({ threads, selectedThreadId, onSelect, onDelete }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<ConversationItem>();
  const [deleting, setDeleting] = useState(false);
  const grouped = groupThreads(threads);

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(undefined);
    } catch {
      // The parent exposes the API error in the global alert; keep this dialog open.
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {threads.length === 0 ? <p className="p-5 text-center text-sm text-muted-foreground">아직 저장된 대화가 없습니다.</p> : (
        <div className="w-full min-w-0 space-y-4 overflow-hidden pb-2">
          {GROUPS.map((group) => grouped[group].length > 0 ? (
            <section key={group} className="w-full min-w-0">
              <h2 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">{group}</h2>
              <div className="w-full min-w-0 space-y-0.5">
                {grouped[group].map((thread) => (
                  <div key={thread.id} className={cn('group flex w-full min-w-0 items-center overflow-hidden rounded-lg transition-colors hover:bg-sidebar-accent', thread.id === selectedThreadId && 'bg-sidebar-accent text-sidebar-accent-foreground')}>
                    <button type="button" className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => onSelect(thread.id)}>
                      <span className="block truncate text-sm">{thread.title}</span>
                      <time className="mt-0.5 block text-[11px] text-muted-foreground" dateTime={thread.last_activity_at}>{formatTime(thread.last_activity_at)}</time>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="mr-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`${thread.title} 메뉴`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(thread)}>
                          <Trash2 /> 삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </section>
          ) : null)}
        </div>
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 대화를 영구 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              ‘{deleteTarget?.title}’ 대화와 모든 메시지, 답변 근거가 즉시 삭제됩니다. 삭제한 내용은 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => { event.preventDefault(); void confirmDelete(); }}
            >
              {deleting ? '삭제 중…' : '영구 삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
