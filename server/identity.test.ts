import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signCustomerIdentity, verifyCustomerIdentity } from './identity.ts';

const SECRET = 'idsec_test_secret_0123456789';

test('accepts a valid fresh signature', () => {
  const ts = Date.now();
  const claim = { customerId: 'cust_42', sig: signCustomerIdentity(SECRET, 'cust_42', ts), ts };
  const result = verifyCustomerIdentity(SECRET, claim);
  assert.equal(result.valid, true);
  assert.equal(result.customerId, 'cust_42');
});

test('rejects a tampered customer id', () => {
  const ts = Date.now();
  const claim = { customerId: 'victim_99', sig: signCustomerIdentity(SECRET, 'cust_42', ts), ts };
  assert.equal(verifyCustomerIdentity(SECRET, claim).valid, false);
});

test('rejects a signature from the wrong secret', () => {
  const ts = Date.now();
  const claim = { customerId: 'cust_42', sig: signCustomerIdentity('other_secret', 'cust_42', ts), ts };
  assert.equal(verifyCustomerIdentity(SECRET, claim).valid, false);
});

test('rejects an expired signature', () => {
  const ts = Date.now() - 16 * 60 * 1000;
  const claim = { customerId: 'cust_42', sig: signCustomerIdentity(SECRET, 'cust_42', ts), ts };
  assert.equal(verifyCustomerIdentity(SECRET, claim).valid, false);
});

test('rejects a far-future timestamp', () => {
  const ts = Date.now() + 10 * 60 * 1000;
  const claim = { customerId: 'cust_42', sig: signCustomerIdentity(SECRET, 'cust_42', ts), ts };
  assert.equal(verifyCustomerIdentity(SECRET, claim).valid, false);
});

test('rejects missing claims and unconfigured bots', () => {
  assert.equal(verifyCustomerIdentity(SECRET, null).valid, false);
  assert.equal(verifyCustomerIdentity('', { customerId: 'a', sig: 'b', ts: Date.now() }).valid, false);
});