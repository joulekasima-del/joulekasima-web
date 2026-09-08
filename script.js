document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- Mobile nav ---------- */
const navToggle = document.getElementById('navToggle');
const primaryNav = document.getElementById('primaryNav');

navToggle.addEventListener('click', () => {
  const isOpen = primaryNav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

primaryNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    primaryNav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

/* ---------- Contact form (demo) ---------- */
const form = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  formNote.hidden = false;
  form.reset();
});

/* ---------- Language switching ---------- */
const translations = {
  'nav-services': { en: 'Services', th: 'บริการ' },
  'nav-ventures': { en: 'Ventures', th: 'โปรเจกต์' },
  'nav-creative': { en: 'Creative', th: 'งานสร้างสรรค์' },
  'nav-contact': { en: 'Contact', th: 'ติดต่อ' },

  'hero-kicker': { en: 'Bot development · Ventures · Creative work', th: 'พัฒนาบอท · โปรเจกต์ · งานสร้างสรรค์' },
  'hero-headline': { en: 'I build the systems behind fast replies and new ideas.', th: 'ฉันสร้างระบบที่อยู่เบื้องหลังการตอบกลับที่รวดเร็วและไอเดียใหม่ ๆ' },
  'hero-sub': {
    en: "I'm Joule Kasima — I build automation for businesses on Instagram, Facebook, and Telegram, plus a handful of things I've built myself.",
    th: 'ฉันคือ Joule Kasima สร้างระบบอัตโนมัติให้ธุรกิจบน Instagram, Facebook และ Telegram พร้อมกับโปรเจกต์ส่วนตัวอีกไม่กี่อย่างที่ลงมือทำเอง'
  },
  'hero-btn-1': { en: "See what I'm building", th: 'ดูสิ่งที่กำลังสร้าง' },
  'hero-btn-2': { en: 'Bot development', th: 'พัฒนาบอท' },

  'track-1-title': { en: 'Standard auto-reply bots', th: 'บอทตอบกลับอัตโนมัติ' },
  'track-1-desc': {
    en: 'Rule-based bots for Instagram, Facebook, and Telegram — FAQs, order status, booking flows, answered instantly. Fast to set up, predictable, reliable.',
    th: 'บอทแบบตั้งกฎสำหรับ Instagram, Facebook และ Telegram ตอบคำถามที่พบบ่อย สถานะคำสั่งซื้อ และขั้นตอนการจองได้ทันที ติดตั้งไว ผลลัพธ์แน่นอน เชื่อถือได้'
  },
  'track-1-link': { en: 'Get a bot built', th: 'เริ่มสร้างบอท' },
  'track-2-badge': { en: 'New', th: 'ใหม่' },
  'track-2-title': { en: 'AI bots', th: 'บอท AI' },
  'track-2-desc': {
    en: "Conversational bots that handle follow-up questions and nuance a script can't. Built for any business that's drowning in DMs and wants replies to feel like a real conversation.",
    th: 'บอทสนทนาที่ตอบคำถามต่อเนื่องและรายละเอียดที่สคริปต์ทำไม่ได้ เหมาะกับธุรกิจที่มีข้อความเข้ามาจำนวนมากและอยากให้การตอบรู้สึกเหมือนคุยกับคนจริง'
  },
  'track-2-link': { en: 'Get a bot built', th: 'เริ่มสร้างบอท' },

  'ventures-title': { en: 'Ventures', th: 'โปรเจกต์' },
  'ventures-intro': {
    en: "Things I've built myself, alongside client work — some live, some still taking shape.",
    th: 'สิ่งที่ลงมือสร้างเองควบคู่ไปกับงานลูกค้า บางอย่างเปิดใช้งานแล้ว บางอย่างยังอยู่ระหว่างพัฒนา'
  },

  'spotlight-eyebrow': { en: 'Launching this week', th: 'เปิดตัวสัปดาห์นี้' },
  'spotlight-tagline': { en: 'Learn to actually speak Thai — one small break a day.', th: 'เรียนพูดภาษาไทยได้จริง วันละนิด ทุกวัน' },
  'spotlight-desc': {
    en: 'Thai Talk Breaks is a 30-day conversational Thai course built for real life, not textbooks. Each day brings one picture, one useful phrase, clear native pronunciation, and a quick explanation you can use right away. No Thai script required — just Thai you can understand, say, and use.',
    th: 'Thai Talk Breaks คือคอร์สภาษาไทยสนทนา 30 วัน ที่ออกแบบมาเพื่อใช้ในชีวิตจริง ไม่ใช่ตำราเรียน ในแต่ละวันจะได้รับหนึ่งภาพ หนึ่งวลีที่ใช้ได้จริง เสียงอ่านจากเจ้าของภาษาที่ชัดเจน และคำอธิบายสั้น ๆ ที่นำไปใช้ได้ทันที ไม่ต้องรู้ตัวอักษรไทยมาก่อน แค่เข้าใจ พูดได้ และใช้ได้จริง'
  },
  'spotlight-trial': { en: 'Your first 7 days are free.', th: '7 วันแรกทดลองใช้ฟรี' },
  'spotlight-li-1': { en: '30 days of short, practical daily lessons', th: 'บทเรียนสั้น ๆ ที่ใช้ได้จริง ครบ 30 วัน' },
  'spotlight-li-2': { en: 'One phrase, one picture, real native pronunciation — every day', th: 'หนึ่งวลี หนึ่งภาพ พร้อมเสียงจากเจ้าของภาษา ทุกวัน' },
  'spotlight-li-3': { en: 'No alphabet or grammar drills, just speaking', th: 'ไม่มีท่องตัวอักษรหรือไวยากรณ์ เน้นพูดอย่างเดียว' },
  'spotlight-li-4': { en: 'Free for 7 days, then continue with Telegram Stars', th: 'ฟรี 7 วันแรก จากนั้นชำระต่อผ่าน Telegram Stars' },
  'spotlight-community': {
    en: 'Want more practice? Join <strong>Thai Talk: Jot It Down</strong> — a weekly Saturday exercise with the community, hosted by Chaa-yen.',
    th: 'อยากฝึกเพิ่มเติมไหม? เข้าร่วม <strong>Thai Talk: Jot It Down</strong> กิจกรรมฝึกภาษาทุกเช้าวันเสาร์กับชุมชน จัดโดยชาเย็น'
  },
  'spotlight-btn-1': { en: 'Start your free 7 days', th: 'เริ่มทดลองฟรี 7 วัน' },
  'spotlight-btn-2': { en: 'Join the community', th: 'เข้าร่วมชุมชน' },

  'jp-desc': {
    en: 'A travel planning platform for conservation-based trips in Thailand, with AI woven into how it plans. Still experimenting — details coming soon.',
    th: 'แพลตฟอร์มวางแผนการเดินทางเพื่อการท่องเที่ยวเชิงอนุรักษ์ในประเทศไทย ผสาน AI เข้ากับการวางแผน ยังอยู่ระหว่างทดลอง รายละเอียดเร็ว ๆ นี้'
  },
  'jp-status': { en: 'In development', th: 'กำลังพัฒนา' },
  'kj-desc': { en: 'Event organizing — launching soon.', th: 'จัดกิจกรรมและอีเวนต์ เปิดตัวเร็ว ๆ นี้' },
  'kj-status': { en: 'Coming soon', th: 'เร็ว ๆ นี้' },

  'creative-title': { en: 'Creative', th: 'งานสร้างสรรค์' },
  'creative-desc': { en: 'New work in progress — check back soon.', th: 'งานใหม่กำลังอยู่ระหว่างทำ แวะมาดูอีกครั้งเร็ว ๆ นี้' },

  'about-title': { en: 'About', th: 'เกี่ยวกับฉัน' },
  'about-desc': {
    en: "I'm Joule Kasima, based in Chiang Mai. I build messaging automation for businesses and spend the rest of my time building my own things — Journey Planner, Kraft Junction, and whatever's next.",
    th: 'ฉันคือ Joule Kasima อาศัยอยู่ที่เชียงใหม่ สร้างระบบข้อความอัตโนมัติให้ธุรกิจ และใช้เวลาที่เหลือสร้างโปรเจกต์ของตัวเอง อย่าง Journey Planner, Kraft Junction และสิ่งต่อไปที่กำลังจะมา'
  },
  'about-link': { en: 'Get in touch', th: 'ติดต่อฉัน' },

  'contact-title': { en: "Let's talk", th: 'มาคุยกัน' },
  'contact-sub': {
    en: 'Need a bot built, or just want to say hi? Send a note — I read every one.',
    th: 'ต้องการสร้างบอท หรือแค่อยากทักทาย? ส่งข้อความมาได้เลย ฉันอ่านทุกข้อความ'
  },
  'label-name': { en: 'Name', th: 'ชื่อ' },
  'label-email': { en: 'Email', th: 'อีเมล' },
  'label-message': { en: "What's on your mind", th: 'มีอะไรอยากบอกไหม' },
  'btn-send': { en: 'Send message', th: 'ส่งข้อความ' },
  'form-note': {
    en: 'Thanks — this is a demo form. Connect it to Formspree, Resend, or a similar service before launch.',
    th: 'ขอบคุณค่ะ — ฟอร์มนี้เป็นเดโม โปรดเชื่อมต่อกับ Formspree, Resend หรือบริการที่คล้ายกันก่อนเปิดใช้งานจริง'
  }
};

const langButtons = document.querySelectorAll('.lang-btn');

function setLanguage(lang) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const entry = translations[key];
    if (entry && entry[lang]) {
      el.innerHTML = entry[lang];
    }
  });

  document.documentElement.lang = lang;
  document.body.classList.toggle('lang-th', lang === 'th');

  langButtons.forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-lang') === lang);
  });

  try { localStorage.setItem('joulekasima-lang', lang); } catch (e) { /* ignore */ }
}

langButtons.forEach(btn => {
  btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
});

let savedLang = 'en';
try { savedLang = localStorage.getItem('joulekasima-lang') || 'en'; } catch (e) { /* ignore */ }
setLanguage(savedLang);
