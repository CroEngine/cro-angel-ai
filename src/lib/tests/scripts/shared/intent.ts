// THE shared CTA-intent classifier — single source of truth for both
// in-browser audit scripts (B1 in docs/contradictions-audit.md).
//
// History: CTAS_SCRIPT and COLLECT_SCRIPT each carried their own copy of the
// intent wordlists and rule order. The copies drifted (different Swedish
// terms, a form-submit rule in one but not the other, a regex typo that never
// matched "lägg i varukorgen") — so the same button could be a conversion CTA
// in one half of the findings report and not in the other. This function is
// inlined into BOTH scripts via `${classifyIntentShared.toString()}` (the
// same pattern collect.ts already uses for isVisible), so the lists cannot
// drift again — and it is imported directly by unit tests.
//
// Contract: PURE and self-contained — no imports, no closures, no DOM access.
// Callers pre-compute everything DOM-derived (attr text, category, fold).
//
// Rule order (deliberate, golden-affecting — change with care):
//   1. form submits are conversions (a submit is the form's whole point);
//   2. social-host links stay social no matter the label ("Subscribe" on a
//      YouTube link is not a site conversion);
//   3. conversion keywords — BEFORE the tel:/mailto: check, so "Ring och
//      boka" reads as the conversion it is (A1);
//   4. contact actions (tel:/mailto:/contact wording) are their own intent —
//      NOT 'utility': for lead-gen businesses contact IS the goal, and the
//      goal system already treats it that way (A1);
//   5. the remaining wordlists in the order collect.ts always used;
//   6. same-page anchors (tabs/TOC) with no keyword evidence are in-page
//      NAVIGATION — the position fallback must never promote them (a booking
//      service page's "Bilder"/"Betyg"/"Om" tab strip is above-fold primary
//      chrome, not conversion; verbs still win, so <a href="#bokning">Boka</a>
//      classifies as the conversion it is);
//   7. position fallback: an above-fold primary with no keyword evidence is
//      most likely a conversion.
//
// Vocabulary provenance: EN+SV mined from corpus/vocab-harvest-2026-07-06.json
// (107-site harvest, inclusion bar >= 2 independent sites) with two deliberate
// deltas: \btry\b added (English twin of "prova"; harvest caught those via the
// position fallback so mining missed the word) and `book` tightened to
// \bbook\b ("Employee handbook"/"Share on Facebook" are not bookings).
// 2026-07-14, owner decision "alla språk": the DETERMINISTIC floor was
// widened to ~30 major languages (curated high-precision action verbs, not
// mined — reviewed per language for substring safety). This floor is what the
// in-browser scripts can ever have; ALL remaining languages are covered by the
// LLM layer server-side (labeler.server.ts / goal-judge.server.ts, any
// language, confidence-floored) — lists are the floor, never the ceiling.
//
// Regex safety rules for contributors:
//   * \b is ASCII-only in JS. Use it ONLY around fully-ASCII words
//     ("\\bkaufen\\b" — so "verkaufen"/"Einkaufen" never match). A term whose
//     FIRST or LAST character is non-ASCII must NOT be \b-anchored
//     (/\bкупить\b/ can never match — both neighbours are non-word chars).
//   * Non-Latin scripts match as plain substrings, exactly like the Swedish
//     terms always have.
//   * Login/anmelden/تسجيل الدخول-style terms belong in the NAVIGATION list,
//     never conversion — a signup word that doubles as login (German
//     "anmelden") goes to navigation: conservative exclusion beats wrongly
//     calling a login button the money action.
export function classifyIntentShared(
  text: string,
  href: string,
  attrText: string,
  category: string,
  isFormSubmit: boolean,
  aboveFold: boolean,
  formKind?: "" | "search" | "newsletter",
  samePageAnchor?: boolean,
):
  | "conversion"
  | "contact"
  | "engagement"
  | "navigation"
  | "social"
  | "utility"
  | "information"
  | "unknown" {
  const t = (text || "").trim();
  const probe = t + " " + (attrText || "");
  const h = href || "";

  // A submit is the form's whole point — but WHAT it converts depends on the
  // form (A2): a search submit is utility, an email-only newsletter submit is
  // engagement (the subscribe wordlist's home), everything else conversion.
  // Callers derive formKind with formKindShared().
  if (isFormSubmit) {
    if (formKind === "search") return "utility";
    if (formKind === "newsletter") return "engagement";
    return "conversion";
  }
  if (
    /(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|snapchat|reddit|threads|mastodon)\./i.test(
      h,
    )
  ) {
    return "social";
  }
  const CONV = [
    // engelska
    "\\bbook\\b|buy|demo|start|get started|sign[- ]?up|signup|register|subscribe|request|trial|\\btry\\b|checkout|order|apply|donate|download|add to cart",
    // svenska
    "beställ|köp|boka|prova|kom igång|skapa konto|registrera|gå med|gratis|ladda ne[dr]|lägg i (varu|kund)?korg(en)?|lägg till|ansök|bidra|donera|teckna|jämför|shoppa|månadsgivare",
    // tyska ("anmelden" är login-tvetydigt → navigation, inte här)
    "\\bkaufen\\b|warenkorb|zur kasse|bestellen|registrieren|konto erstellen|kostenlos|ausprobieren|buchen|termin vereinbaren|herunterladen|spenden|abonnieren|angebot anfordern|loslegen",
    // franska (s.inscrire: punkten matchar båda apostrof-varianterna ' och ’)
    "acheter|ajouter au panier|commander|s.inscrire|inscription|essai gratuit|essayer|réserver|commencer|télécharger|faire un don|s.abonner|demander un devis|rendez-vous",
    // spanska + portugisiska
    "comprar|añadir al carrito|agregar al carrito|registrarse|regístrate|prueba gratis|reservar|comenzar|empieza|descargar|\\bdonar\\b|suscr|solicitar|cotización|adicionar ao carrinho|cadastr|teste grátis|experimente|começar|baixar|\\bdoar\\b|assinar|orçamento",
    // italienska
    "acquista|\\bcompra\\b|aggiungi al carrello|\\bordina\\b|registrati|iscriviti|prenota|inizia|scarica|abbonati|richiedi",
    // nederländska ("boeken" = även "böcker" — bara entydiga boknings-former)
    "\\bkopen\\b|koop nu|winkelwagen|winkelmand|gratis proberen|proberen|boek nu|te boeken|reserveren|aan de slag|downloaden|doneren|abonneren|offerte|registreren",
    // danska + norska
    "\\bkøb\\b|læg i kurv|\\bkjøp\\b|handlekurv|\\bbestil\\b|\\bbestill\\b|tilmeld|prøv|kom i gang|last ned|få tilbud|abonner|reserver",
    // finska
    "\\bosta\\b|koriin|\\btilaa\\b|rekisteröidy|kokeile|\\bvaraa\\b|aloita|\\blataa\\b|lahjoita",
    // polska + tjeckiska
    "\\bkup\\b|do koszyka|zamów|zarejestruj|wypróbuj|zarezerwuj|rozpocznij|pobierz|zapisz się|koupit|do košíku|objednat|vyzkoušet|rezervovat|stáhnout|začít",
    // ryska + ukrainska (kyrilliska: rena substrängar — \\b fungerar inte)
    "купить|в корзину|заказать|зарегистр|регистрация|попробо|забронир|скачать|подписаться|оформить|придбати|замовити|зареєстру|спробувати|завантажити",
    // grekiska
    "αγορά|στο καλάθι|παραγγελία|εγγραφή|δοκιμ|κράτηση|ξεκινήστε|λήψη",
    // turkiska (\\bindir\\b så "indirim" (rea) inte träffar)
    "satın al|sepete ekle|sipariş|kayıt ol|üye ol|\\bdene\\b|rezervasyon|başla|\\bindir\\b|bağış|abone ol|teklif al",
    // arabiska + hebreiska ("سجل الآن" registrera; login تسجيل الدخول → navigation)
    "اشتر|السلة|اطلب|سجل الآن|إنشاء حساب|جرب|احجز|ابدأ|تحميل|تبرع|اشترك|קנה|קנייה|הוסף לסל|הזמן|הרשמה|נסה|התחל|הורד|תרום",
    // hindi
    "खरीदें|कार्ट|ऑर्डर करें|रजिस्टर|पंजीकरण|आज़माएं|बुक करें|शुरू करें|डाउनलोड|दान करें",
    // japanska (bara sammansatta 登録-former — ログイン → navigation)
    "購入|カートに入れる|カートに追加|注文|会員登録|新規登録|登録する|無料体験|お試し|予約|申し込|資料請求|見積|ダウンロード|寄付",
    // kinesiska (förenklad + traditionell)
    "购买|加入购物车|下单|订购|注册|免费试用|试用|预订|预约|下载|捐赠|订阅|購買|加入購物車|註冊|預約|下載|捐款|訂閱",
    // koreanska
    "구매|장바구니|주문|회원가입|가입하기|무료 체험|체험하기|예약|시작하기|다운로드|기부|구독|신청",
    // vietnamesiska + thai + indonesiska/malajiska ("daftar" bara i entydiga
    // sammansättningar — "Daftar Isi" är en innehållsförteckning)
    "\\bmua\\b|vào giỏ|đặt hàng|đăng ký|dùng thử|đặt chỗ|bắt đầu|tải xuống|quyên góp|ซื้อ|ตะกร้า|สั่งซื้อ|สมัคร|ทดลอง|จอง|เริ่ม|ดาวน์โหลด|บริจาค|\\bbeli\\b|keranjang|pesan sekarang|pemesanan|daftar sekarang|daftar akun|coba gratis|\\bcoba\\b|unduh|donasi|berlangganan",
  ].join("|");
  if (new RegExp(CONV, "i").test(probe)) {
    return "conversion";
  }
  // "letişim" utan i: turkiskt İ (U+0130) case-foldar inte till "i" i JS-regex,
  // så "iletişim" skulle missa rubrikformen "İletişim".
  const CONTACT =
    "contact|kontakt|contato|contatto|επικοιν|контакт|связаться|letişim|اتصل|تواصل|צור קשר|संपर्क|問い合わせ|お問合せ|联系|聯絡|문의|liên hệ|ติดต่อ|hubungi";
  if (/^(tel:|mailto:)/i.test(h) || new RegExp(CONTACT, "i").test(probe)) return "contact";
  if (
    /(like|love|save|bookmark|share|comment|reply|follow|subscribe|upvote|downvote|gilla|spara|kommentar|svara|följ|prenumerera|rösta|röst)/i.test(
      probe,
    )
  ) {
    return "engagement";
  }
  const NAV = [
    "login|log in|sign in|account|menu|home|profile|settings|logga in|mina sidor|hem|inställningar",
    // inloggning/konto på övriga språk — medvetet FÖRE positions-fallbacken,
    // och tvetydiga registrera/logga-in-ord (de "anmelden") hör hemma HÄR
    "einloggen|\\banmelden\\b|mein konto|se connecter|connexion|mon compte|iniciar sesión|mi cuenta|\\bentrar\\b|accedi|il mio account|inloggen|mijn account|log ind|logg inn|min side|kirjaudu|zaloguj|moje konto|войти|вход|личный кабинет|giriş|تسجيل الدخول|התחבר|लॉग ?इन|ログイン|マイページ|登录|登入|로그인|마이페이지|đăng nhập|เข้าสู่ระบบ|\\bmasuk\\b",
  ].join("|");
  if (new RegExp(NAV, "i").test(probe)) {
    return "navigation";
  }
  if (/(facebook|instagram|linkedin|twitter|youtube|tiktok|share|dela)/i.test(probe)) {
    return "social";
  }
  if (/(search|sök|language|språk|cookie|accept|godkänn|help|hjälp|faq)/i.test(probe)) {
    return "utility";
  }
  if (/(learn|read|explore|see how|how |why |about |läs|utforska|så funkar|mer info)/i.test(probe)) {
    return "information";
  }
  // Same-page anchor with NO keyword evidence (nothing above matched): an
  // in-page tab/TOC link — navigation, and deliberately BEFORE the position
  // fallback so an above-fold tab strip ("Bilder"/"Betyg"/"Om") can't be
  // promoted to conversion by placement alone. Callers compute the flag from
  // the DOM: an <a> whose href resolves to location's origin+path+search with
  // a fragment.
  if (samePageAnchor) return "navigation";
  // Position-based fallback: above-fold primary CTA without keyword match →
  // likely conversion.
  if (category === "cta_primary" && aboveFold) return "conversion";
  return "unknown";
}

/** Same-page anchor (tab/TOC): href resolves to THIS page + a fragment. Feeds
 *  rule 6 in classifyIntentShared — tabs must never be position-fallbacked to
 *  conversion. The comparison base is the page's DECLARED URL (canonical/
 *  og:url) with location as fallback: in MHTML replay location is a file://
 *  URL while the capture's anchors are absolute https self-URLs — without the
 *  declared base the rule never flips in replay and live/replay diverge.
 *  Page-safe contract: touches only its args + document/location, never throws. */
export function samePageAnchorShared(el: Element, href: string): boolean {
  if (el.tagName !== "A" || !href) return false;
  try {
    let pageUrl = new URL(location.href);
    const canon = document.querySelector('link[rel="canonical"]');
    const og = document.querySelector('meta[property="og:url"]');
    const declared =
      (canon && canon.getAttribute("href")) || (og && og.getAttribute("content")) || "";
    if (declared && /^https?:/i.test(declared)) pageUrl = new URL(declared);
    const u = new URL(href, pageUrl.href);
    return (
      !!u.hash &&
      u.origin === pageUrl.origin &&
      u.pathname === pageUrl.pathname &&
      u.search === pageUrl.search
    );
  } catch (e) {
    return false; // trasig href -> ingen flagga
  }
}

/** What kind of form does this (submit) element belong to? Same page-safe
 *  contract as isVisible: touches only its argument + DOM. Drives the A2
 *  rule in classifyIntentShared — search submits are not conversions, and an
 *  email-only field means a newsletter capture, not the site's money action. */
export function formKindShared(el: Element): "" | "search" | "newsletter" {
  try {
    const f = el.closest ? el.closest("form") : null;
    if (!f) return "";
    const role = (f.getAttribute("role") || "").toLowerCase();
    const action = f.getAttribute("action") || "";
    if (role === "search" || f.querySelector('input[type="search"]') || /(^|[/?#-])s(earch|ok)([/?#-]|$)/i.test(action)) {
      return "search";
    }
    const inputs = f.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])',
    );
    if (inputs.length === 1) {
      const i0 = inputs[0];
      const hint = (
        (i0.getAttribute("type") || "") + " " +
        (i0.getAttribute("name") || "") + " " +
        (i0.getAttribute("placeholder") || "") + " " +
        (i0.getAttribute("aria-label") || "")
      ).toLowerCase();
      if (/email|e-?post|nyhetsbrev|newsletter/.test(hint)) return "newsletter";
    }
  } catch (e) {
    /* classification must never break the page */
  }
  return "";
}
