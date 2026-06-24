import type { SafeUser } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/auth/permissions';
import LogoutButton from './LogoutButton';

// Shown to a logged-in user whose account is not (yet) approved.
export default function AccessGate({ user }: { user: SafeUser }) {
  const pending = user.status === 'pending';
  return (
    <div className="gatewrap">
      <div className="gatecard">
        <h1>{pending ? 'Account in attesa di approvazione' : 'Accesso non consentito'}</h1>
        {pending ? (
          <p>
            Ciao {user.name || user.email}, la tua registrazione è stata ricevuta. Un
            amministratore deve approvare il tuo account prima che tu possa accedere alla
            dashboard.
          </p>
        ) : (
          <p>
            Il tuo account è stato <b>{STATUS_LABEL[user.status]?.toLowerCase()}</b>. Contatta un
            amministratore per maggiori informazioni.
          </p>
        )}
        <p style={{ marginTop: 18 }}>
          <LogoutButton className="ubtn bad" label="Esci" />
        </p>
      </div>
    </div>
  );
}
