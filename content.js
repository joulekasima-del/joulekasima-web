/*
  SITE CONTENT
  ------------
  Every piece of text on the page lives here, organized by section.
  To change wording, edit the "en" and "th" values below — no HTML/CSS knowledge needed.
  index.html references these by key (e.g. "hero.headline"); script.js does the lookup.
*/

const SITE_CONTENT = {

  hero: {
    headline: { en: "I build things that make people feel taken care of.", th: "ฉันสร้างสิ่งที่ทำให้คนรู้สึกได้รับการดูแล" },
    sub: {
      en: "I'm Joule Kasima — ten years in customer service, now channeled into bot automation for businesses and ventures like Thai Talk Breaks and Journey Planner. Every one of them starts from the same idea: make people feel looked after.",
      th: 'ฉันคือ Joule Kasima ประสบการณ์ 10 ปีในงานบริการลูกค้า ที่ตอนนี้ถ่ายทอดสู่ระบบบอทอัตโนมัติสำหรับธุรกิจ และโปรเจกต์ต่าง ๆ อย่าง Thai Talk Breaks และ Journey Planner ทุกอย่างเริ่มต้นจากความคิดเดียวกัน คือทำให้ทุกคนรู้สึกว่ามีคนดูแล'
    }
  },

  services: {
    standard: {
      title: { en: 'Standard auto-reply bots', th: 'บอทตอบกลับอัตโนมัติ' },
      desc: {
        en: 'Rule-based bots for Instagram, Facebook, and Telegram — FAQs, order status, booking flows, answered instantly. Fast to set up, predictable, reliable.',
        th: 'บอทแบบตั้งกฎสำหรับ Instagram, Facebook และ Telegram ตอบคำถามที่พบบ่อย สถานะคำสั่งซื้อ และขั้นตอนการจองได้ทันที ติดตั้งไว ผลลัพธ์แน่นอน เชื่อถือได้'
      }
    },
    ai: {
      title: { en: 'AI bots', th: 'บอท AI' },
      desc: {
        en: "Conversational bots that handle follow-up questions and nuance a script can't. Built for any business that's drowning in DMs and wants replies to feel like a real conversation.",
        th: 'บอทสนทนาที่ตอบคำถามต่อเนื่องและรายละเอียดที่สคริปต์ทำไม่ได้ เหมาะกับธุรกิจที่มีข้อความเข้ามาจำนวนมากและอยากให้การตอบรู้สึกเหมือนคุยกับคนจริง'
      }
    }
  },

  ventures: {
    title: { en: 'Ventures', th: 'โปรเจกต์' },
    intro: {
      en: 'Everything here grows from the same instinct as the client work — customer service and hospitality, turned into things that stand on their own. Some are live, some still taking shape.',
      th: 'ทุกอย่างที่นี่เติบโตมาจากสัญชาตญาณเดียวกับงานลูกค้า คือการบริการและการต้อนรับที่ถูกเปลี่ยนให้เป็นสิ่งที่ยืนได้ด้วยตัวเอง บางอย่างเปิดใช้งานแล้ว บางอย่างยังอยู่ระหว่างพัฒนา'
    },

    thaiTalkBreaks: {
      tagline: { en: 'Learn to actually speak Thai — one small break a day.', th: 'เรียนพูดภาษาไทยได้จริง วันละนิด ทุกวัน' },
      desc: {
        en: 'Thai Talk Breaks is a 30-day conversational Thai course built for real life, not textbooks. Each day brings one picture, one useful phrase, clear native pronunciation, and a quick explanation you can use right away. No Thai script required — just Thai you can understand, say, and use.',
        th: 'Thai Talk Breaks คือคอร์สภาษาไทยสนทนา 30 วัน ที่ออกแบบมาเพื่อใช้ในชีวิตจริง ไม่ใช่ตำราเรียน ในแต่ละวันจะได้รับหนึ่งภาพ หนึ่งวลีที่ใช้ได้จริง เสียงอ่านจากเจ้าของภาษาที่ชัดเจน และคำอธิบายสั้น ๆ ที่นำไปใช้ได้ทันที ไม่ต้องรู้ตัวอักษรไทยมาก่อน แค่เข้าใจ พูดได้ และใช้ได้จริง'
      },
      trial: { en: 'Your first 7 days are free.', th: '7 วันแรกทดลองใช้ฟรี' },
      list: [
        { en: '30 days of short, practical daily lessons', th: 'บทเรียนสั้น ๆ ที่ใช้ได้จริง ครบ 30 วัน' },
        { en: 'One phrase, one picture, real native pronunciation — every day', th: 'หนึ่งวลี หนึ่งภาพ พร้อมเสียงจากเจ้าของภาษา ทุกวัน' },
        { en: 'No alphabet or grammar drills, just speaking', th: 'ไม่มีท่องตัวอักษรหรือไวยากรณ์ เน้นพูดอย่างเดียว' },
        { en: 'Free for 7 days, then continue with Telegram Stars', th: 'ฟรี 7 วันแรก จากนั้นชำระต่อผ่าน Telegram Stars' }
      ],
      community: {
        en: 'Want more practice? Join <strong>Thai Talk: Jot It Down</strong> — a weekly Saturday exercise with the community.',
        th: 'อยากฝึกเพิ่มเติมไหม? เข้าร่วม <strong>Thai Talk: Jot It Down</strong> กิจกรรมฝึกภาษาทุกเช้าวันเสาร์กับชุมชน'
      }
    },

    journeyPlanner: {
      desc: {
        en: 'A travel planning platform for conservation-based trips in Thailand, with AI woven into how it plans. Still experimenting — details coming soon.',
        th: 'แพลตฟอร์มวางแผนการเดินทางเพื่อการท่องเที่ยวเชิงอนุรักษ์ในประเทศไทย ผสาน AI เข้ากับการวางแผน ยังอยู่ระหว่างทดลอง รายละเอียดเร็ว ๆ นี้'
      }
    },

    kraftJunction: {
      desc: { en: 'Event organizing where tradition craft meets 21st-century craft. Launching soon.', th: 'จัดกิจกรรมและอีเวนต์ที่ผสานงานฝีมือดั้งเดิมเข้ากับงานฝีมือยุคใหม่ เปิดตัวเร็ว ๆ นี้' }
    }
  },

  creative: {
    desc:  { en: 'Research, writing, and the occasional blog post — coming soon.', th: 'งานวิจัย งานเขียน และบล็อกเป็นครั้งคราว เร็ว ๆ นี้' }
  },

  about: {
    title: { en: 'About', th: 'เกี่ยวกับฉัน' },
    desc: {
      en: "I'm Joule Kasima, based in Chiang Mai. I build messaging automation for businesses and spend the rest of my time building my own things — Journey Planner, Kraft Junction, and whatever's next.",
      th: 'ฉันคือ Joule Kasima อาศัยอยู่ที่เชียงใหม่ สร้างระบบข้อความอัตโนมัติให้ธุรกิจ และใช้เวลาที่เหลือสร้างโปรเจกต์ของตัวเอง อย่าง Journey Planner, Kraft Junction และสิ่งต่อไปที่กำลังจะมา'
    }
  },

  contact: {
    title: { en: "Let's talk", th: 'มาคุยกัน' },
    sub: {
      en: 'Need a bot built, or just want to say hi? Send a note — I read every one.',
      th: 'ต้องการสร้างบอท หรือแค่อยากทักทาย? ส่งข้อความมาได้เลย ฉันอ่านทุกข้อความ'
    },
    labelName:    { en: 'Name', th: 'ชื่อ' },
    labelEmail:   { en: 'Email', th: 'อีเมล' },
    labelMessage: { en: "What's on your mind", th: 'มีอะไรอยากบอกไหม' },
    formNote: {
      en: 'Thanks — this is a demo form. Connect it to Formspree, Resend, or a similar service before launch.',
      th: 'ขอบคุณค่ะ — ฟอร์มนี้เป็นเดโม โปรดเชื่อมต่อกับ Formspree, Resend หรือบริการที่คล้ายกันก่อนเปิดใช้งานจริง'
    }
  }

};
