// SPDX-License-Identifier: AGPL-3.0-only
// Presentation only: never rewrite the native prompt or a recoverable draft.
export function questionPresentation(item, questions = []) {
  const identity = /^question:([a-f0-9]{64}):(expiry|dismissal|answer|late:[a-f0-9]{64})$/.exec(item.agentDelivery || '');
  if (!identity || typeof item.wire !== 'string' || item.text !== item.wire) return null;
  const question = questions.find(value => value.questionId === identity[1]);
  const delivery = question?.deliveries?.find(value => value.id === item.agentDelivery);
  if (!delivery || typeof question.text !== 'string') return null;
  const action = identity[2].split(':')[0];
  let text;
  if (action === 'expiry') {
    if (delivery.source !== 'expiry' || item.wire !== `[Optional question ${question.questionId}: ${question.text}]\nBackend timeout notice: No response; proceed with the best long-term solution. This is not a user choice or permission approval.`) return null;
    text = 'No reply was received before this question expired.';
  } else if (action === 'dismissal') {
    if (delivery.source !== 'dismissal' || item.wire !== `[Optional question ${question.questionId}: ${question.text}]\nUser dismissed this optional question without an answer. Proceed with the best long-term solution. This is not a user choice or permission approval.`) return null;
    text = 'You dismissed this question without an answer.';
  } else {
    if (!['web', 'call', 'notification', 'voicemail'].includes(delivery.source)) return null;
    if (action === 'answer') {
      if (typeof question.answer !== 'string' || item.wire !== `[User answer to optional question ${question.questionId}: ${question.text}]\n${question.answer}`) return null;
      text = question.answer;
    } else {
      const prefix = `[User follow-up to ${question.status === 'expired' ? 'expired' : 'already answered'} optional question ${question.questionId}: ${question.text}]\n`;
      if (!['expired', 'answered'].includes(question.status) || !item.wire.startsWith(prefix)) return null;
      text = item.wire.slice(prefix.length);
    }
  }
  return { text, agentSource: { kind: 'question', action, source: delivery.source, question: question.text } };
}
