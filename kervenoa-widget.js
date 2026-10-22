/* Kervenoa launcher v1.0.0 — public presentation only; no keys or tariffs. */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script) return;
  const client = script.dataset.client || 'nippon-heritage';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(client)) return;
  const company = script.dataset.company || 'Nippon Héritage';
  const start = () => {
    if (document.getElementById('kervenoa-launcher')) return;
    const host = document.createElement('div');
    host.id = 'kervenoa-launcher';
    // Inline host positioning prevents site CSS from moving the launcher.
    host.style.cssText = 'all:initial;position:fixed!important;right:max(18px,env(safe-area-inset-right))!important;bottom:calc(20px + env(safe-area-inset-bottom))!important;z-index:2147483000!important;display:block!important;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{color-scheme:light;font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      *{box-sizing:border-box}a,button{-webkit-tap-highlight-color:transparent}
      .wrap{font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;gap:12px}
      .hint{position:relative;max-width:245px;padding:13px 36px 13px 17px;background:#fff;color:#172c46;border:1px solid #e4e7ec;border-radius:18px 18px 4px 18px;box-shadow:0 6px 25px #172c4620}
      .hint>a{color:inherit;text-decoration:none;display:block}.hint strong{font-size:14px;font-weight:750;display:block}.hint span{display:block;font-size:12px;color:#5e6b7a;margin-top:2px}
      .dismiss{position:absolute;right:6px;top:5px;border:0;background:transparent;color:#677284;border-radius:50%;cursor:pointer;width:28px;height:28px;font:20px system-ui}
      .robot{display:grid;place-items:center;width:66px;height:66px;border-radius:23px;background:#172c46;border:2px solid #fff;box-shadow:0 7px 24px #172c4640;transition:transform .16s ease,background .16s ease;color:#fff;text-decoration:none;flex:none}
      .robot:hover{background:#233e60;transform:translateY(-2px)}
      a:focus-visible,button:focus-visible{outline:3px solid #d84050;outline-offset:4px}
      svg{width:43px;height:43px;display:block}.badge{position:absolute;right:1px;bottom:0;width:17px;height:17px;background:#b72c43;border:3px solid white;border-radius:50%}
      @media(max-width:480px){.wrap{gap:8px}.hint{max-width:min(225px,calc(100vw - 110px));padding:11px 31px 11px 13px}.hint strong{font-size:13px}.hint span{font-size:11px}.robot{width:58px;height:58px;border-radius:20px}.robot svg{width:38px;height:38px}}
      @media(prefers-reduced-motion:reduce){.robot{transition:none}.robot:hover{transform:none}}
    </style><div class="wrap">
      <div class="hint"><a class="message" target="_blank" rel="noopener noreferrer"><strong>Une question ?</strong><strong>Besoin d’un devis ?</strong><span>Discutez avec notre assistant ↗</span></a><button class="dismiss" type="button" aria-label="Masquer le message d’accueil">×</button></div>
      <a class="robot" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 7v5" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><circle cx="24" cy="6" r="3" fill="#ed5265"/><rect x="8" y="13" width="32" height="26" rx="10" fill="#fff"/><path d="M5 23v8M43 23v8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><rect x="12" y="19" width="24" height="11" rx="5.5" fill="#172c46"/><circle cx="18" cy="24.5" r="2" fill="#fff"/><circle cx="30" cy="24.5" r="2" fill="#fff"/><path d="M20 34h8" stroke="#b72c43" stroke-width="2.5" stroke-linecap="round"/><path d="m31 38 5 5v-8" fill="#fff"/></svg><span class="badge"></span>
      </a></div>`;
    const url = new URL('https://olivier56880.github.io/NautIA/');
    url.searchParams.set('client', client);
    root.querySelectorAll('a').forEach(a => {
      a.href = url.href;
      a.setAttribute('aria-label', `Poser une question ou demander un devis à ${company} (nouvel onglet)`);
    });
    root.querySelector('.dismiss').addEventListener('click', () => root.querySelector('.hint').remove());
    document.body.appendChild(host);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
