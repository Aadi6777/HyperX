import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Download, Smartphone } from 'lucide-react';
import { buildInviteLink } from '../services/room';
import { copyText } from '../services/roomSync';

interface InviteQrModalProps {
  roomId: string;
  onClose: () => void;
}

/**
 * Shows the room's invite link as a QR code. Point a phone camera at it and the phone opens
 * Nexora already inside this room - no typing of codes.
 */
export const InviteQrModal: React.FC<InviteQrModalProps> = ({ roomId, onClose }) => {
  const link = buildInviteLink(roomId);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A phone can't open "localhost": that address means "this very phone".
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

  useEffect(() => {
    let cancelled = false;
    // Loaded on demand so the QR library isn't part of the initial page weight.
    import('qrcode')
      .then((QR) => QR.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not generate the QR code');
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Rendered into <body>: the panels on this page use backdrop-filter, which would otherwise turn
  // `position: fixed` into "fixed relative to the panel" and push the modal off-screen.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite by QR code"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1.75rem', maxWidth: '400px', width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', textAlign: 'center' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: 'var(--text-primary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Smartphone size={18} style={{ color: 'var(--accent-light-blue)' }} />
            Scan to join room
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', display: 'inline-block', minWidth: 240, minHeight: 240 }}>
          {dataUrl ? (
            <img src={dataUrl} alt={`QR code to join room ${roomId}`} width={240} height={240} style={{ display: 'block' }} data-testid="invite-qr" />
          ) : (
            <div style={{ width: 240, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.8rem' }}>
              {error ?? 'Generating…'}
            </div>
          )}
        </div>

        <div style={{ margin: '0.9rem 0 0.4rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-magenta)', fontWeight: 800, letterSpacing: '0.1em' }}>{roomId}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', wordBreak: 'break-all', marginBottom: '0.9rem' }}>{link}</div>

        {isLocal && (
          <div style={{ background: 'rgba(217, 70, 239, 0.08)', border: '1px solid var(--accent-magenta)', borderRadius: '6px', padding: '0.55rem 0.7rem', fontSize: '0.75rem', color: 'var(--text-primary)', marginBottom: '0.9rem', textAlign: 'left' }}>
            You're on <code>{host}</code>, which a phone can't reach. Open Nexora through your deployed URL (or your computer's
            network address) and the QR code will work from other devices.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center' }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.78rem' }}
            onClick={async () => {
              if (await copyText(link)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy link'}</span>
          </button>
          {dataUrl && (
            <a className="btn-ghost" style={{ padding: '0.4rem 0.8rem', fontSize: '0.78rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} href={dataUrl} download={`nexora-room-${roomId}.png`}>
              <Download size={13} />
              <span>Save QR</span>
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
