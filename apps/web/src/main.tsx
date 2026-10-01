import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPage } from './chat/ChatPage';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <ChatPage />
    </TooltipProvider>
  </StrictMode>
);
