// SMS yuborish adapteri. Hozircha provayder ulanmagan:
//   SMS_MODE=test (standart) — kod server konsoliga yoziladi va API javobida `dev_code` sifatida qaytadi (faqat sinov uchun!).
// Haqiqiy provayder (masalan Eskiz.uz yoki Playmobile) shartnoma va kalitlar olingach shu yerga ulanadi.
const MODE = process.env.SMS_MODE || 'test';

async function send(phone, text) {
  if (MODE === 'test') {
    console.log(`  [SMS sinov] ${phone}: ${text}`);
    return { ok: true, test: true };
  }
  return { ok: false, reason: `SMS provayder "${MODE}" ulanmagan` };
}

module.exports = { send, MODE };
