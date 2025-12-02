#!/usr/bin/env node
/**
 * Test script for Chicago Direct Stream
 *
 * Tests if we can access Chicago local channel HLS manifests directly.
 */

const { chicagoStream, CHICAGO_LOCALS } = require('./chicago-direct-stream');

async function main() {
  console.log('=== Chicago Direct Stream Test ===\n');
  console.log('Testing access to Chicago local channel HLS manifests...\n');

  // Test each channel
  for (const channel of CHICAGO_LOCALS) {
    console.log(`\n--- Testing ${channel.callSign} (${channel.channelName}) ---`);
    console.log(`CCID: ${channel.ccid}`);

    try {
      const result = await chicagoStream.testStream(channel.callSign, '720');

      if (result.success) {
        console.log(`✓ SUCCESS`);
        console.log(`  URL: ${result.url}`);
        console.log(`  Variants: ${result.variants}`);
        console.log(`  Audio tracks: ${result.audioTracks}`);
        console.log(`  Widevine DRM: ${result.hasWidevine ? 'YES' : 'NO'}`);
        console.log(`  FairPlay DRM: ${result.hasFairplay ? 'YES' : 'NO'}`);

        if (result.widevineKeys && result.widevineKeys.length > 0) {
          console.log(`\n  Widevine PSSH data:`);
          for (const key of result.widevineKeys) {
            console.log(`    KeyID: ${key.keyId}`);
            console.log(`    PSSH: ${key.pssh}`);
          }
        }
      } else {
        console.log(`✗ FAILED: ${result.error}`);
      }
    } catch (err) {
      console.log(`✗ ERROR: ${err.message}`);
    }
  }

  console.log('\n\n=== Summary ===');
  console.log('If manifests are accessible, the next step is Widevine license decryption.');
  console.log('The PSSH data above can be used with a Widevine CDM to get decryption keys.');
}

main().catch(console.error);
