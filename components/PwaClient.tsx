'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';

// Progressive enhancement only: every branch below degrades to "render nothing"
// when service workers / install events are unsupported or fail.

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_COOKIE = 'pwa_install_dismissed';
const DISMISS_DAYS = 30;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// iPadOS 13+ reports as a Mac: tell it apart by touch support.
const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Only Safari offers "Aggiungi a Home" in the Share sheet of this flow.
const isIosSafari = () => isIos() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(navigator.userAgent);

const isAndroid = () => /Android/i.test(navigator.userAgent);

const wasDismissed = () => document.cookie.split('; ').some((c) => c.startsWith(DISMISS_COOKIE + '=1'));

const rememberDismissal = () => {
  try {
    document.cookie = `${DISMISS_COOKIE}=1; max-age=${DISMISS_DAYS * 86400}; path=/; SameSite=Lax`;
  } catch {
    /* cookies blocked: in-memory state still hides it for this page view */
  }
};

export default function PwaClient() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const reloadOnChange = useRef(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Service worker registration (production only; dev would serve stale chunks).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let cancelled = false;

    const track = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          // "installed" with an existing controller = an update, not the first install.
          if (sw.state === 'installed' && navigator.serviceWorker.controller && !cancelled) setWaiting(sw);
        });
      });
    };

    const onControllerChange = () => {
      // Reload only after the user accepted the update, never unprompted.
      if (reloadOnChange.current) window.location.reload();
    };

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(track)
        .catch(() => {
          /* registration failed: the site keeps working without the worker */
        });
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  // Install banner eligibility.
  useEffect(() => {
    if (isStandalone() || wasDismissed()) return;

    if (isIosSafari()) setShowIos(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      // Mobile Android only; desktop Chrome keeps its own address-bar install icon.
      if (isAndroid()) setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setShowIos(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    // Don't strand keyboard users on an element that is about to disappear.
    if (bannerRef.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    rememberDismissal();
    setDismissed(true);
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch {
      /* prompt already used or blocked */
    }
    setInstallEvent(null);
  }, [installEvent]);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    reloadOnChange.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  const showInstall = !dismissed && (installEvent !== null || showIos);
  const showUpdate = waiting !== null && !updateDismissed;
  if (!showInstall && !showUpdate) return null;

  return (
    <div className="pwa-stack">
      {showUpdate && (
        <div className="pwa-card pwa-update" role="status">
          <span className="pwa-text">Aggiornamento disponibile</span>
          <button type="button" className="pwa-btn" onClick={applyUpdate}>
            Ricarica
          </button>
          <button type="button" className="pwa-x" aria-label="Chiudi avviso aggiornamento" onClick={() => setUpdateDismissed(true)}>
            ×
          </button>
        </div>
      )}
      {showInstall && (
        <div
          ref={bannerRef}
          className="pwa-card"
          role="region"
          aria-label="Installa l'app"
          onKeyDown={(e) => e.key === 'Escape' && dismiss()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 36px static icon, no optimisation needed */}
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="pwa-icon" />
          {installEvent ? (
            <>
              <span className="pwa-text">Installa Monitor IF/BO sul tuo dispositivo</span>
              <button type="button" className="pwa-btn" onClick={install}>
                Installa app
              </button>
            </>
          ) : (
            <span className="pwa-text">
              Per installare l&apos;app tocca <strong>Condividi</strong> <span aria-hidden="true">⎙</span> e poi{' '}
              <strong>Aggiungi a Home</strong>
            </span>
          )}
          <button type="button" className="pwa-x" aria-label="Chiudi suggerimento di installazione" onClick={dismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
