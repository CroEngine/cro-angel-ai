// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const FORMS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    return 'form:nth-of-type(' + (Array.from(document.querySelectorAll('form')).indexOf(el) + 1) + ')';
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


