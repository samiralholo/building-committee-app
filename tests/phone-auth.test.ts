// Run: pnpm test:unit   (node's built-in test runner, TypeScript via type stripping)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHONE_INVALID_MESSAGE,
  displayableEmail,
  formatPhoneForDisplay,
  isSyntheticPhoneEmail,
  normalizePhone,
  phoneToAuthEmail,
  resolveLoginIdentifier,
} from '../src/app/core/phone-auth.ts';

const ok = (raw: string, expected: string) => assert.deepEqual(normalizePhone(raw), { ok: true, phone: expected }, raw);
const bad = (raw: unknown) =>
  assert.deepEqual(normalizePhone(raw as string), { ok: false, error: PHONE_INVALID_MESSAGE }, String(raw));

test('Eastern Arabic and Persian digits', () => {
  ok('٠٩١٢٣٤٥٦٧٨', '963912345678');
  ok('۰۹۱۲۳۴۵۶۷۸', '963912345678');
  ok('+٩٦٣ ٩١٢ ٣٤٥ ٦٧٨', '963912345678');
  ok('٠٩12 ٣٤5 678', '963912345678'); // mixed
});

test('spaces, dashes, parentheses, dots', () => {
  ok('+963 912-345-678', '963912345678');
  ok('(0912) 345.678', '963912345678');
  ok('0912 – 345 – 678', '963912345678'); // en dash
  ok(' 0912345678 ', '963912345678'); // NBSP
});

test('00 / + international prefixes', () => {
  ok('00963912345678', '963912345678');
  ok('+963912345678', '963912345678');
  ok('+963 0912 345 678', '963912345678'); // trunk 0 after the country code
  ok('963912345678', '963912345678'); // already normalized
});

test('local formats use the default country code', () => {
  ok('0912345678', '963912345678');
  ok('912345678', '963912345678');
  ok('0112345678', '963112345678'); // Damascus landline
});

test('invisible RTL/LTR marks are ignored', () => {
  ok('‏0912345678‎', '963912345678');
  ok('‫+963 912 345 678‬', '963912345678');
  ok('⁦٠٩١٢٣٤٥٦٧٨⁩', '963912345678');
  ok('﻿0912345678', '963912345678');
});

test('non-Syrian international numbers are preserved', () => {
  ok('+971501234567', '971501234567');
  ok('00971 50 123 4567', '971501234567');
  ok('+1 (415) 555-0100', '14155550100');
  ok('+44 7911 123456', '447911123456');
});

test('invalid input returns the Arabic error', () => {
  bad('');
  bad('   ');
  bad('12345');
  bad('091234'); // too short
  bad('abc');
  bad('0912abc678');
  bad('09123456789012345'); // too long
  bad('+0912345678'); // leading zero after +
  bad('++963912345678');
  bad(null);
  bad(undefined);
});

test('resolveLoginIdentifier: email passthrough (superadmin & legacy)', () => {
  assert.deepEqual(resolveLoginIdentifier('samir.alholo.98@gmail.com'), {
    kind: 'email',
    authEmail: 'samir.alholo.98@gmail.com',
  });
  assert.deepEqual(resolveLoginIdentifier('  Samir.Alholo.98@Gmail.COM '), {
    kind: 'email',
    authEmail: 'samir.alholo.98@gmail.com',
  });
});

test('resolveLoginIdentifier: phones become the synthetic auth email', () => {
  for (const input of ['0912345678', '٠٩١٢٣٤٥٦٧٨', '+963 912 345 678', '00963912345678', '912345678', '‏0912-345-678']) {
    assert.deepEqual(
      resolveLoginIdentifier(input),
      { kind: 'phone', normalizedPhone: '963912345678', authEmail: '963912345678@phone.lajna.app' },
      input,
    );
  }
});

test('resolveLoginIdentifier: garbage is invalid with the Arabic message', () => {
  assert.deepEqual(resolveLoginIdentifier('hello'), { kind: 'invalid', error: PHONE_INVALID_MESSAGE });
  assert.deepEqual(resolveLoginIdentifier(''), { kind: 'invalid', error: PHONE_INVALID_MESSAGE });
});

test('synthetic email helpers', () => {
  assert.equal(phoneToAuthEmail('963912345678'), '963912345678@phone.lajna.app');
  assert.equal(isSyntheticPhoneEmail('963912345678@phone.lajna.app'), true);
  assert.equal(isSyntheticPhoneEmail('963912345678@PHONE.LAJNA.APP'), true);
  assert.equal(isSyntheticPhoneEmail('samir.alholo.98@gmail.com'), false);
  assert.equal(isSyntheticPhoneEmail('x@phone.lajna.app.evil.com'), false);
  assert.equal(displayableEmail('963912345678@phone.lajna.app'), null);
  assert.equal(displayableEmail('samir.alholo.98@gmail.com'), 'samir.alholo.98@gmail.com');
});

test('formatPhoneForDisplay', () => {
  assert.equal(formatPhoneForDisplay('963912345678'), '+963 912 345 678');
  assert.equal(formatPhoneForDisplay('971501234567'), '+971501234567');
  assert.equal(formatPhoneForDisplay('14155550100'), '+14155550100');
  assert.equal(formatPhoneForDisplay(''), '');
});
