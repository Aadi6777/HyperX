import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardCopy, FileText, Send, ClipboardPaste, Copy, Check, ExternalLink, Download, Trash2, Users } from 'lucide-react';
import { WebRtcEngine, LinkState } from '../services/webrtcEngine';
import { NotesSync, ClipboardSync, ClipItem, MAX_NOTE_LENGTH, MAX_CLIP_LENGTH, copyText } from '../services/roomSync';

interface RoomToolsProps {
  engine: WebRtcEngine | null;
  links: Record<string, LinkState>;
}

type Tab = 'clipboard' | 'notes';

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Shared clipboard + CRDT notes for everyone in the room. Both features live as long as the
 * engine does (not as long as a tab is visible), so notes keep syncing while you're on the
 * clipboard tab.
 */
export const RoomTools: React.FC<RoomToolsProps> = ({ engine, links }) => {
  const [tab, setTab] = useState<Tab>('notes');
  const [notes, setNotes] = useState<NotesSync | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardSync | null>(null);

  useEffect(() => {
    if (!engine) return;
    const n = new NotesSync(engine);
    const c = new ClipboardSync(engine);
    setNotes(n);
    setClipboard(c);
    return () => {
      n.dispose();
      c.dispose();
      setNotes(null);
      setClipboard(null);
    };
  }, [engine]);

  const linked = Object.values(links).filter((s) => s === 'open').length;

  const tabBtn = (id: Tab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer',
        padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
        background: tab === id ? 'var(--bauhaus-blue)' : 'rgba(255,255,255,0.04)',
        color: '#fff', border: `1px solid ${tab === id ? 'var(--bauhaus-blue)' : 'var(--border-subtle)'}`, borderRadius: '6px',
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <section className="glass-panel" style={{ padding: '1.75rem', marginBottom: '2.5rem' }} aria-label="Room tools">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.1rem' }}>
        <div role="tablist" style={{ display: 'flex', gap: '0.5rem' }}>
          {tabBtn('notes', 'Live Notes', <FileText size={14} />)}
          {tabBtn('clipboard', 'Shared Clipboard', <ClipboardCopy size={14} />)}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: linked ? 'var(--accent-green)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          <Users size={13} />
          {linked ? `${linked} peer${linked > 1 ? 's' : ''} linked` : 'no peers linked yet'}
        </span>
      </div>

      <div style={{ display: tab === 'notes' ? 'block' : 'none' }}>{notes && <NotesPad notes={notes} linked={linked} />}</div>
      <div style={{ display: tab === 'clipboard' ? 'block' : 'none' }}>{clipboard && <ClipboardPad clipboard={clipboard} linked={linked} />}</div>
    </section>
  );
};

/* ------------------------------------------------------------------ notes */

/**
 * Where should the caret go after the text changed underneath it? Compare the old and new text:
 * unchanged prefix -> caret stays; unchanged suffix -> caret shifts by the length difference;
 * inside the changed region -> snap to its start.
 */
function mapCaret(oldText: string, newText: string, offset: number): number {
  let prefix = 0;
  const max = Math.min(oldText.length, newText.length);
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
  if (offset <= prefix) return offset;
  if (offset >= oldText.length - suffix) return offset + (newText.length - oldText.length);
  return prefix;
}

const NotesPad: React.FC<{ notes: NotesSync; linked: number }> = ({ notes, linked }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [stats, setStats] = useState(notes.doc.stats());
  const [tooBig, setTooBig] = useState(false);

  // Push the document's text into the textarea when a REMOTE edit arrives, keeping the user's caret
  // where it logically was. (Local typing already shows in the textarea, so it needs no update.)
  const syncTextarea = () => {
    const el = ref.current;
    if (!el) return;
    const next = notes.text();
    const prev = el.value;
    if (prev === next) return;
    const focused = document.activeElement === el;
    const start = mapCaret(prev, next, el.selectionStart);
    const end = mapCaret(prev, next, el.selectionEnd);
    el.value = next;
    if (focused) el.setSelectionRange(start, end);
  };

  useLayoutEffect(() => {
    syncTextarea();
    setStats(notes.doc.stats());
    return notes.onChange((remote) => {
      if (remote) syncTextarea();
      setStats(notes.doc.stats());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const accepted = notes.edit(el.value);
    if (!accepted) {
      setTooBig(true);
      el.value = notes.text();
    } else {
      setTooBig(false);
    }
  };

  const download = () => {
    const blob = new Blob([notes.text()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexora-notes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div>
      <textarea
        ref={ref}
        onInput={onInput}
        aria-label="Shared live notes"
        placeholder="Type here - everyone in this room sees it live. Edits merge automatically, even if two people type at once or someone was offline."
        spellCheck={false}
        style={{ width: '100%', minHeight: '220px', resize: 'vertical', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-subtle)', borderRadius: '8px', color: '#fff', padding: '0.9rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: 1.55, outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.6rem' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} data-testid="notes-stats">
          {stats.visible} chars &bull; CRDT (RGA) &bull; {stats.nodes} nodes
          {stats.pending > 0 ? ` • ${stats.pending} waiting for deps` : ''} &bull;{' '}
          {linked ? `live with ${linked} peer${linked > 1 ? 's' : ''}` : 'saved locally until a peer joins'}
          {' '}&bull; max {MAX_NOTE_LENGTH.toLocaleString()}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn-ghost" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }} onClick={() => copyText(notes.text())}>
            <Copy size={13} /><span>Copy all</span>
          </button>
          <button type="button" className="btn-ghost" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }} onClick={download}>
            <Download size={13} /><span>Download .txt</span>
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
            onClick={() => {
              if (notes.text() && window.confirm('Clear the notes for everyone in the room?')) {
                notes.edit('');
                if (ref.current) ref.current.value = '';
              }
            }}
          >
            <Trash2 size={13} /><span>Clear</span>
          </button>
        </div>
      </div>
      {tooBig && <div style={{ color: 'var(--bauhaus-red)', fontSize: '0.78rem', marginTop: '0.4rem' }}>That would exceed the {MAX_NOTE_LENGTH.toLocaleString()}-character limit, so it was not applied.</div>}
    </div>
  );
};

/* -------------------------------------------------------------- clipboard */

const ClipboardPad: React.FC<{ clipboard: ClipboardSync; linked: number }> = ({ clipboard, linked }) => {
  const [items, setItems] = useState<ClipItem[]>([]);
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => clipboard.onChange(setItems), [clipboard]);

  const send = () => {
    const delivered = clipboard.send(draft);
    if (delivered === 0) {
      setHint('Saved to your list, but no peer is linked yet - nobody received it.');
    } else {
      setHint(null);
      setDraft('');
    }
  };

  const paste = async () => {
    try {
      setDraft((await navigator.clipboard.readText()).slice(0, MAX_CLIP_LENGTH));
      setHint(null);
    } catch {
      setHint('Your browser blocked clipboard access - paste into the box with Ctrl/Cmd+V instead.');
    }
  };

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_CLIP_LENGTH))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send();
        }}
        aria-label="Text to share"
        placeholder="Paste a link, snippet or message to push to every device in this room…  (Ctrl/Cmd+Enter to send)"
        style={{ width: '100%', minHeight: '90px', resize: 'vertical', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-subtle)', borderRadius: '8px', color: '#fff', padding: '0.8rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn-hyper-nav" style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }} disabled={!draft.trim()} onClick={send}>
          <Send size={14} /><span>Send to room{linked ? ` (${linked})` : ''}</span>
        </button>
        <button type="button" className="btn-ghost" style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }} onClick={paste}>
          <ClipboardPaste size={13} /><span>Paste from clipboard</span>
        </button>
        {items.length > 0 && (
          <button type="button" className="btn-ghost" style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', marginLeft: 'auto' }} onClick={() => clipboard.clear()}>
            <Trash2 size={13} /><span>Clear list</span>
          </button>
        )}
      </div>
      {hint && <div style={{ color: 'var(--bauhaus-yellow)', fontSize: '0.78rem', marginTop: '0.5rem' }}>{hint}</div>}

      <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }} aria-live="polite">
        {items.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Nothing shared yet. Items live only in this browser tab and on connected peers - they are never stored on a server.</div>}
        {items.map((it) => (
          <div key={it.id} data-testid="clip-item" style={{ background: 'rgba(10,10,26,0.75)', border: `1px solid ${it.mine ? 'var(--border-subtle)' : 'var(--bauhaus-blue)'}`, borderRadius: '8px', padding: '0.8rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontFamily: 'var(--font-mono)' }}>
              <span>
                {it.mine ? 'You' : it.from} &bull; {timeOf(it.at)}
                {it.mine && it.deliveredTo !== undefined ? ` • delivered to ${it.deliveredTo}` : ''}
              </span>
              <span style={{ display: 'flex', gap: '0.4rem' }}>
                {isUrl(it.text) && (
                  <a className="btn-ghost" href={it.text.trim()} target="_blank" rel="noopener noreferrer" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <ExternalLink size={11} /><span>Open</span>
                  </a>
                )}
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                  onClick={async () => {
                    if (await copyText(it.text)) {
                      setCopiedId(it.id);
                      setTimeout(() => setCopiedId((c) => (c === it.id ? null : c)), 1400);
                    }
                  }}
                >
                  {copiedId === it.id ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copiedId === it.id ? 'Copied' : 'Copy'}</span>
                </button>
              </span>
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '160px', overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#fff' }}>{it.text}</pre>
          </div>
        ))}
      </div>
    </div>
  );
};
