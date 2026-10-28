export const formatCurrency = (value: number): string => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '$0';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}; 