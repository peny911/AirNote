import { useEffect } from 'react';

const SPARKLE_COLORS = ['#6366F1', '#8B5CF6', '#38BDF8', '#EC4899', '#34D399'];

export function burstSparkles(
  evt: { clientX?: number; clientY?: number } | null | undefined,
  softGlow: boolean,
): void {
  if (softGlow || typeof document === 'undefined') return;
  const x = evt?.clientX || window.innerWidth / 2;
  const y = evt?.clientY || window.innerHeight / 2;

  for (let i = 0; i < 6; i++) {
    const el = document.createElement('span');
    el.className = 'sparkle-burst';
    el.textContent = i % 2 === 0 ? '✦' : '✧';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = SPARKLE_COLORS[i % SPARKLE_COLORS.length];
    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
    const distance = 24 + Math.random() * 28;
    el.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
    el.style.setProperty('--ty', `${Math.sin(angle) * distance - 8}px`);
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 740);
  }
}

export function triggerEntranceSheen(softGlow: boolean): void {
  if (softGlow || typeof document === 'undefined') return;
  const buttons = document.querySelectorAll<HTMLElement>('.btn-crystal');
  buttons.forEach((btn) => {
    btn.classList.remove('sheen-once');
    void btn.offsetWidth;
    btn.classList.add('sheen-once');
  });
  window.setTimeout(() => {
    document.querySelectorAll<HTMLElement>('.btn-crystal').forEach((btn) => {
      btn.classList.remove('sheen-once');
    });
  }, 1200);
}

export function useSpecularTracking(): void {
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      document.querySelectorAll<HTMLElement>('.specular-track').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
          el.style.setProperty('--my', `${e.clientY - rect.top}px`);
        }
      });
    };

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => document.removeEventListener('pointermove', onPointerMove);
  }, []);
}
