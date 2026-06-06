export function matchesRule(commentText, rule) {
  const matchMode = rule?.match_mode ?? rule?.matchMode;
  if (matchMode !== 'contains_any') {
    return false;
  }

  const normalizedCommentText = String(commentText ?? '').toLowerCase();
  const keywords = String(rule?.keyword_text ?? rule?.keywordText ?? '')
    .split(',')
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length > 0);

  return keywords.some((keyword) => normalizedCommentText.includes(keyword));
}
