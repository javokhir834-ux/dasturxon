// Tarmoq termoprinteriga (ESC/POS, port 9100) chop etish.
// Printer manzili: "192.168.1.50" yoki "192.168.1.50:9100". Bo'sh bo'lsa - chop etilmaydi.
const net = require('net');

const ESC = '\x1b', GS = '\x1d';
const ascii = (s) => String(s)
  .replace(/[ʻʼ‘’`]/g, "'")
  .normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '');

function send(address, text) {
  return new Promise((resolve) => {
    if (!address) return resolve({ ok: false, reason: 'printer sozlanmagan' });
    const [host, port] = address.split(':');
    const sock = net.createConnection({ host, port: Number(port) || 9100 });
    const done = (r) => { sock.destroy(); resolve(r); };
    sock.setTimeout(4000, () => done({ ok: false, reason: 'timeout' }));
    sock.on('error', (e) => done({ ok: false, reason: e.message }));
    sock.on('connect', () => {
      const payload = ESC + '@' + ascii(text) + '\n\n\n\n' + GS + 'V' + '\x41' + '\x03';
      sock.write(Buffer.from(payload, 'latin1'), () => done({ ok: true }));
    });
  });
}

const line = (l = 32) => '-'.repeat(l);

function kitchenTicket({ workshop, order, table, waiter, items }) {
  const rows = items.map((i) => {
    let s = `${i.qty} x ${i.name}`;
    const mods = JSON.parse(i.modifiers || '[]');
    if (mods.length) s += '\n    + ' + mods.map((m) => m.name).join(', ');
    if (i.comment) s += `\n    ! ${i.comment}`;
    return s;
  });
  return [ESC + '!' + '\x30' + workshop.toUpperCase() + ESC + '!' + '\x00',
    `Buyurtma #${order.number}  ${table || ''}`, `Ofitsiant: ${waiter || ''}`,
    new Date().toLocaleTimeString('uz-UZ'), line(), ...rows, line()].join('\n');
}

module.exports = { send, kitchenTicket };
