// Pure permission helpers — no server-only imports, safe in client components.
import type { Role, SafeUser } from '../types';

// Can the user see pages/data? (approved account of any role)
export function canView(u: SafeUser | null | undefined): boolean {
  return !!u && u.status === 'approved';
}

// Can the user modify pages/data? (ADMIN or USERPLUS, approved)
export function canEdit(u: SafeUser | null | undefined): boolean {
  return !!u && u.status === 'approved' && (u.role === 'ADMIN' || u.role === 'USERPLUS');
}

export function isAdmin(u: SafeUser | null | undefined): boolean {
  return !!u && u.role === 'ADMIN';
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Amministratore',
  USERPLUS: 'Utente (visualizza + modifica)',
  USER: 'Utente (sola visualizzazione)',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'In attesa di approvazione',
  approved: 'Approvato',
  rejected: 'Rifiutato',
};
