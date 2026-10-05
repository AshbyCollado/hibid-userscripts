import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRetailCandidate,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.ts';

test('inline model name recovers the dock identity and rejects a similar wrong dock', () => {
  const identity = extractProductIdentity(
    '$63 Lenovo Legion Go USB-C Dock - 4K/2K @60Hz',
    'Data Transfer Rate: 640 Mbps Model name: GX91P83696 Battery: No Battery Used.',
  );

  assert.equal(identity.model, 'GX91P83696');
  assert.match(identity.query, /gx91p83696/i);
  assert.equal(
    evaluateRetailCandidate(
      'Lenovo GX91P83696 USB-C Dock - 4K/2K @60Hz',
      identity,
    ).accepted,
    true,
  );
  assert.equal(
    evaluateRetailCandidate(
      'Lenovo USB-C Slim Travel Dock, 8 Ports, Up to 65W PD Pass Through, Integrated USB-C Cable, 4K Display Support, Black',
      identity,
    ).accepted,
    false,
  );
});

test('the captured full Lenovo description retains its inline model identity', () => {
  const identity = extractProductIdentity(
    '$63 Lenovo Legion Go USB-C Dock - 4K/2K @60Hz',
    'Brand: Lenovo\nCondition: New\nIn Packaging?: Yes\nAssembly Required?: No\nDamaged?: No\nFunctional?: Yes\nMissing Parts?: No\nStar Rating: 0.0\nUPC: 195892101826\nTitle: $63 Lenovo Legion Go USB-C Dock - 4K/2K @60Hz\nShipping Available: Yes\n\nFully functional USB-CHarness the speed and reliability of USB-C. This dock amps up your data transfer rates, charging capabilities, and display options, ensuring your gaming rig runs at peak efficiency with zero lag. All-In-One connectivity Amplify your gaming setup with an array of port options. From connecting an extra screen to maintaining a stable Ethernet connection, this dock eliminates cable chaos and keeps your focus on defeating the enemy. Crystal-clear 4K visuals Step into visually stunning worlds with 4K support at 60Hz. Experience every game with extraordinary clarity and sharpness, making your on-screen adventures more lifelike and engaging. Highlights: Connectivity Technology: Wired Charging Capability: Yes Device Supported: Handheld Computer Features: Power Delivery Pass-through Screen Mode Supported: 4K @ 60Hz, 2K, 4K Specifications: Dimensions (Overall): 1.21 inches (H) x 5.1 inches (W) x 2.89 inches (D) Weight: .52 pounds Number of USB ports: 4 Data Transfer Rate: 640 Mbps Model name: GX91P83696 Battery: No Battery Used.',
  );
  assert.equal(identity.model, 'GX91P83696');
  assert.match(identity.query, /gx91p83696/i);
});

test('explicit description model label variants are recognized', () => {
  for (const label of ['Model name', 'Model no.', 'Model number', 'Model #', 'MPN', 'Model']) {
    const identity = extractProductIdentity('Lenovo USB-C Dock', `${label}: GX91P83696 Battery: No Battery Used.`);
    assert.equal(identity.model, 'GX91P83696', label);
  }
});

test('condition field streams preserve the final brand/model fields ahead of warehouse batch codes', () => {
  const description = 'Notes: Packaging slightly torn / like new / unable to test Condition: Excellent Damaged?: No In Packaging?: No Assembly Required?: No Star Rating: 0.0 Missing Parts?: No Functional?: Unable to Test UPC: 803492139063 Brand: Hampton Bay Model: E1401BN02X10 Title: J2 Classic Scroll 2x10 Steel Floor Register Ni LotNumber: 1205 HiBidShippingAvailability: True The Hampton Bay E1401-BN 2 in. X 10 in. Classic Scroll Floor Register features high quality steel used to cover floor vent openings';
  const identity = extractProductIdentity('J2 Classic Scroll 2x10 Steel Floor Register Ni', description);
  assert.equal(identity.model, 'E1401BN02X10');
  assert.match(identity.query, /e1401bn02x10/i);
  assert.doesNotMatch(identity.query, /\bj2\b/i);
});

test('interface names do not masquerade as title models', () => {
  for (const title of ['Lenovo USB-C Dock', 'Anker USB-A Hub', 'HDMI Cable 6ft']) {
    assert.equal(extractProductIdentity(title).model, null, title);
  }
});

test('genuine title models remain authoritative over conflicting description fields', () => {
  const receiver = extractProductIdentity(
    'Onkyo TX-SR304 Multi-Channel AV Receiver',
    'Model Name: WRONG123 Model Number: OTHER456',
  );
  assert.equal(receiver.model, 'TX-SR304');

  const microphone = extractProductIdentity('Rode NT-USB+ USB Microphone', 'Model: OTHER456');
  assert.equal(microphone.model, 'NT-USB+');
});

test('conflicting explicit description models are not selected', () => {
  const identity = extractProductIdentity(
    'Lenovo USB-C Dock',
    'Model Name: GX91P83696 Model Number: GX91P83697 Battery: No Battery Used.',
  );
  assert.equal(identity.model, null);
  assert.doesNotMatch(identity.query, /gx91p8369[67]/i);
});

test('multiword model fields are not truncated into a false model code', () => {
  const identity = extractProductIdentity(
    'SCUF ENVISION PRO Wireless Controller for PC -',
    'Brand: SCUF Model: ENVISION PRO Condition: Used',
  );
  assert.equal(identity.model, null);
});

test('prose mentioning model cars is not an explicit model field', () => {
  const identity = extractProductIdentity(
    'Vintage Toy Collection',
    'This lot contains model cars and assorted accessories.',
  );
  assert.equal(identity.model, null);
});

test('compatibility and policy prose cannot inject a model identity', () => {
  for (const description of [
    'Compatible with Lenovo model: GX91P83696',
    'Shipping policy: example model: ABC123',
    'Example model: ABC123',
    'Warranty: model: ABC123',
    'Fits Lenovo model: GX91P83696',
  ]) {
    assert.equal(extractProductIdentity('Generic USB-C Dock', description).model, null, description);
  }
});

test('prose suffixes in delimited model fields are not accepted as the code', () => {
  for (const description of ['Model: ABC123 is compatible', 'Model: ABC123 extra', 'Model: ABC123***', 'Model: ABC123 extra\nCondition: Used']) {
    const identity = extractProductIdentity('Generic USB-C Dock', description);
    assert.equal(identity.model, null, description);
    assert.doesNotMatch(identity.query, /abc123/i, description);
  }
});

test('complete spaced manufacturer models corroborated by the title remain intact', () => {
  const identity = extractProductIdentity(
    'Glorious GMBK 75% Keyboard with MX-Keycaps',
    'Brand: Glorious\nModel: GMBK 75%',
  );
  assert.equal(identity.model, 'GMBK 75%');
  assert.equal(evaluateRetailCandidate('Glorious GMBK 75% Keyboard with MX-Keycaps', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Glorious GMMK 3 75% Keyboard with MX-Keycaps', identity).accepted, false);
});

test('inline model extraction stops at the next labeled field', () => {
  const identity = extractProductIdentity(
    'Lenovo USB-C Dock',
    'Data Transfer Rate: 640 Mbps Model name: GX91P83696 Battery: No Battery Used. Color: Black',
  );
  assert.equal(identity.model, 'GX91P83696');
  assert.doesNotMatch(identity.model || '', /battery|no|used/i);
});
