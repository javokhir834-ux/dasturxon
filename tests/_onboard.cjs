// Testlar uchun: biznes va kuryer so'rovnomasi hamda maxfiylik testining to'g'ri javoblari (src/modules/onboarding.ts).
const BIZ = {
  application: { place_type: 'restoran', legal_form: 'yatt', legal_name: 'Sinov YaTT', inn: '123456789', address: 'Navoiy, Sinov ko\'chasi 1',
    work_hours: '09:00-23:00', own_couriers: false, staff_count: 5, daily_orders: 40 },
  consent: { answers: [0, 1, 0, 1, 1], agree: true },
};
const COURIER_APP = { birth_year: 1995, district: 'Navoiy shahri', availability: ['kunduzi', 'kechqurun'], experience: true, smartphone_gps: true };
const COURIER_CONSENT = { answers: [1, 1, 0, 1, 1], agree: true };
module.exports = { BIZ, COURIER_APP, COURIER_CONSENT };
