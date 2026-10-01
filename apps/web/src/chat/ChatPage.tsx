import { useState } from 'react';
import { AlertCircle, Menu } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ConversationSidebar } from './components/ConversationSidebar';
import { MessageComposer } from './components/MessageComposer';
import { MessageList } from './components/MessageList';
import { useChat } from './hooks/useChat';

export function ChatPage() {
  const chat = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebar = (
    <ConversationSidebar
      threads={chat.threads}
      selectedThreadId={chat.selectedThreadId}
      loading={chat.loadingThreads}
      searching={chat.searching}
      searchResults={chat.searchResults}
      hasMore={chat.hasMore}
      onNew={() => { chat.startNewThread(); setSidebarOpen(false); }}
      onLoadMore={chat.loadMoreThreads}
      onSearch={chat.searchThreads}
      onSelect={(threadId) => { void chat.selectThread(threadId); setSidebarOpen(false); }}
      onDelete={chat.deleteThread}
    />
  );

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="hidden w-72 shrink-0 border-r bg-sidebar md:block">{sidebar}</div>
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-72 gap-0 p-0" aria-describedby={undefined}>
          <SheetTitle className="sr-only">대화 목록</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-3 md:px-5">
          <Button className="md:hidden" variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label="대화 목록 열기">
            <Menu />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {chat.threads.find((thread) => thread.id === chat.selectedThreadId)?.title ?? '새 대화'}
            </p>
            <p className="text-xs text-muted-foreground">사내 ERP 어시스턴트</p>
          </div>
        </header>
        <Separator />
        {chat.error ? (
          <Alert variant="destructive" className="mx-auto mt-3 w-[calc(100%-2rem)] max-w-3xl">
            <AlertCircle />
            <AlertTitle>요청을 처리하지 못했습니다</AlertTitle>
            <AlertDescription>{chat.error}</AlertDescription>
          </Alert>
        ) : null}
        <MessageList messages={chat.messages} />
        <MessageComposer disabled={chat.streaming} onSend={chat.send} />
      </section>
    </main>
  );
}
