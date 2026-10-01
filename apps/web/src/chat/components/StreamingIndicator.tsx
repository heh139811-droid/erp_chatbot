import { Skeleton } from '@/components/ui/skeleton';

export function StreamingIndicator() {
  return (
    <span className="flex w-36 flex-col gap-2 py-1" aria-label="응답 생성 중" aria-live="polite">
      <Skeleton className="h-2.5 w-full" />
      <Skeleton className="h-2.5 w-3/5" />
    </span>
  );
}
