const LABEL_SEPARATOR = ' · ';

export function sourceLabel(raw) {
  if (typeof raw !== 'string') return undefined;
  const label = raw.replace(/[\s\p{Cc}]+/gu, ' ').trim();
  return label || undefined;
}

export function sourceLabels(raw) {
  if (!Array.isArray(raw)) return undefined;
  const labels = [...new Set(raw.map(sourceLabel).filter(Boolean))].sort();
  return labels.length > 0 ? labels.join(LABEL_SEPARATOR) : undefined;
}

export function departmentTeamFields(department, team) {
  const departmentLabel = sourceLabel(department);
  const teamLabel = sourceLabel(team);
  return {
    ...(departmentLabel ? { department: departmentLabel } : {}),
    ...(teamLabel ? { team: teamLabel } : {}),
  };
}
