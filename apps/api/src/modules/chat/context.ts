import type { ChatMessage, ModelMessage } from './types.js';

const SYSTEM_PROMPT = [
  '당신은 사내 ERP 챗봇이다.',
  '제공된 대화 문맥 안에서만 답하고 알 수 없는 업무 사실을 추측하지 않는다.',
  '사용자의 역할이나 권한을 자연어로 추론하지 않는다.',
  '간결하고 명확한 한국어로 답한다.'
].join('\n');

export function buildModelMessages(history: ChatMessage[], question: string): ModelMessage[] {
  return [
    { role: 'user', content: SYSTEM_PROMPT },
    { role: 'assistant', content: '지침을 확인했습니다.' },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: question }
  ];
}

