// Shared by the browser and route. History is conversational context, never a
// new source of verified CV facts. Keep storage complete; bound model input only.
export const MAX_CHAT_BYTES = 1_000_000;

export function cleanMessages(input) {
  if (!Array.isArray(input) || input.length > 2000) throw new Error('Invalid conversation messages');
  return input.map(m => {
    if (!m || !['user', 'assistant'].includes(m.role)) throw new Error('Invalid message role');
    const parts = Array.isArray(m.parts) ? m.parts : typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : null;
    if (!parts) throw new Error('Invalid message parts');
    return { role: m.role, parts: parts.flatMap(p => {
      if (!p || typeof p !== 'object') throw new Error('Invalid message part');
      if (['text', 'note'].includes(p.type) && typeof p.text === 'string') return [{ type: p.type, text: p.text }];
      if (p.type === 'card' && typeof p.jobId === 'string') return [{ type: p.type, jobId: p.jobId }];
      if (p.type === 'batch' && typeof p.batchId === 'string' && Array.isArray(p.jobIds) && p.jobIds.every(id => typeof id === 'string')) return [{ type: p.type, batchId: p.batchId, jobIds: p.jobIds }];
      // Confirm callbacks exist only in the live component; never resurrect them.
      if (p.type === 'confirm' && p.state === 'pending') return [];
      if (p.type === 'confirm' && ['done', 'cancelled'].includes(p.state) && typeof p.summary === 'string') return [{ type: 'note', text: `${p.summary} (${p.state})` }];
      throw new Error('Invalid message part');
    }) };
  });
}

export function conversationTitle(messages) {
  return messages.find(m => m.role === 'user')?.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').trim().slice(0, 80) || 'New chat';
}

export function buildConversationContext(input = []) {
  if (!Array.isArray(input) || input.length > 2000 || input.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
    throw new Error('Invalid conversation history');
  }
  // Reserve a separate budget for earlier user statements, including the first
  // onboarding turn. Excerpts are literal, labelled, and never model summaries.
  const recent = input.slice(-24);
  const older = input.slice(0, -24).filter(m => m.role === 'user');
  const excerpts = older.map(m => `User excerpt: ${m.content.slice(0, 400)}`).join('\n').slice(0, 8000);
  let remaining = 24000;
  const tail = [];
  for (const m of [...recent].reverse()) {
    const line = `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
    if (line.length > remaining) {
      if (remaining > 40) tail.unshift(`${line.slice(0, remaining - 20)} [excerpt]`);
      break;
    }
    tail.unshift(line);
    remaining -= line.length + 1;
  }
  return [excerpts ? `Earlier user statements (excerpts; not verified profile facts):\n${excerpts}` : '', tail.join('\n')].filter(Boolean).join('\n\n');
}
