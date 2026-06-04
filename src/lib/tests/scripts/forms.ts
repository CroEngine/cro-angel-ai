// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const FORMS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    if (testId) {
      const sel = el.tagName.toLowerCase() + '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
    }
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') && a.value && a.value.length < 64) {
        const sel = el.tagName.toLowerCase() + '[' + a.name + '="' + a.value.replace(/"/g, '\\\\"') + '"]';
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
      }
    }
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && cur.nodeType === 1 && depth < 10) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\\w-]*$/.test(cur.id)) {
        parts.unshift('#' + cur.id);
        const candidate = parts.join(' > ');
        try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (e) {}
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (e) {}
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  function sectionKind(el, rect) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const tag = p.tagName;
      if (tag === 'FOOTER') return 'footer';
      if (tag === 'NAV') return 'nav';
      if (tag === 'HEADER') return 'header';
      p = p.parentElement;
    }
    const docTop = rect.top + window.scrollY;
    if (docTop < viewportH * 1.1) return 'hero';
    return 'content';
  }

  function labelFor(input) {
    if (input.id) {
      const lab = document.querySelector('label[for="' + input.id.replace(/"/g, '\\\\"') + '"]');
      if (lab) return (lab.textContent || '').trim().slice(0, 80);
    }
    const wrap = input.closest('label');
    if (wrap) return (wrap.textContent || '').trim().slice(0, 80);
    return input.getAttribute('placeholder') || input.getAttribute('aria-label') || '';
  }

  const forms = Array.from(document.querySelectorAll('form'));
  const out = [];
  for (const form of forms) {
    const rect = form.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const inputs = Array.from(form.querySelectorAll('input, select, textarea')).filter((i) => {
      const t = (i.getAttribute('type') || '').toLowerCase();
      return t !== 'hidden' && t !== 'submit' && t !== 'button';
    });
    const fields = inputs.map((i) => ({
      name: i.getAttribute('name') || i.getAttribute('id') || '',
      type: (i.getAttribute('type') || i.tagName.toLowerCase()),
      required: i.hasAttribute('required') || i.getAttribute('aria-required') === 'true',
      label: labelFor(i),
    }));
    const allText = fields.map((f) => (f.name + ' ' + f.label + ' ' + f.type)).join(' ').toLowerCase();
    const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    const submitText = submit ? ((submit.innerText || submit.value || '') + '').trim().slice(0, 60) : '';
    const multiStep = !!form.querySelector('[aria-current="step"], .step, [class*="step" i], progress, fieldset legend');

    // social-login detection: scan buttons/links inside form + immediate sibling containers
    const PROVIDERS = [
      { id: 'google', rx: /google/i },
      { id: 'apple', rx: /apple/i },
      { id: 'facebook', rx: /facebook|\\bfb\\b/i },
      { id: 'github', rx: /github/i },
      { id: 'microsoft', rx: /microsoft|\\bms\\b/i },
    ];
    const SSO_RX = /sso|single sign/i;
    const scanScope = [form];
    if (form.parentElement) {
      Array.from(form.parentElement.children).forEach((c) => { if (c !== form) scanScope.push(c); });
    }
    const socialProvidersSet = new Set();
    let ssoSeen = false;
    for (const scope of scanScope) {
      const candidates = scope.querySelectorAll('button, a, [role="button"]');
      for (const c of candidates) {
        const txt = ((c.innerText || c.getAttribute('aria-label') || c.getAttribute('title') || '') + '').toLowerCase();
        if (!txt) continue;
        for (const p of PROVIDERS) { if (p.rx.test(txt)) socialProvidersSet.add(p.id); }
        if (SSO_RX.test(txt)) ssoSeen = true;
      }
    }
    const socialProviders = Array.from(socialProvidersSet);
    if (ssoSeen && socialProviders.length === 0) socialProviders.push('sso');
    const socialLogin = socialProviders.length > 0;

    out.push({
      section: sectionKind(form, rect),
      aboveFold: rect.top < viewportH,
      selector: buildSelector(form),
      fieldCount: fields.length,
      requiredFields: fields.filter((f) => f.required).length,
      containsEmail: /email|e-?post/.test(allText),
      containsPhone: /phone|tel|mobil/.test(allText),
      containsCompany: /company|f[öo]retag|organisation/.test(allText),
      containsPassword: fields.some((f) => f.type === 'password'),
      containsCreditCard: /card|kort|cvc|cvv|expir/.test(allText),
      multiStep,
      socialLogin,
      socialProviders,
      submitText,
      fields,
      rect: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    });
  }
  return out;
})()`;



