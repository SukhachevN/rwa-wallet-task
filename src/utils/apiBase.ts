const configured = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const API_BASE_URL = configured
  ? configured.endsWith('/api')
    ? configured
    : `${configured}/api`
  : '/api';
